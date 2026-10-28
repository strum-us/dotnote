import Anthropic from "@anthropic-ai/sdk";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  DEFAULT_IMAGE_ASPECT_RATIO,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_LLM_MODEL,
  DEFAULT_LLM_PROVIDER,
  IMAGE_ASPECT_RATIOS,
  LLM_PROVIDER_IDS,
  findImageModel,
  getImageModelProvider,
  IMAGE_INPUT_MIME_TYPES,
  isImageAspectRatio,
  isLlmProviderId,
  thinkingControlFor,
  type AiSourceImagePayload,
  type LlmChatMessage,
  type LlmProviderId,
  type LlmSettingsView,
  type LlmStreamEvent,
} from "@shared/llm";
import { decrypt, encrypt } from "./cf-grant";
import type { Env } from "./env";
import type { AppVariables } from "./session";

type ApiKeys = Partial<Record<LlmProviderId, string>>;

type SettingsRow = {
  activeProvider: string;
  model: string;
  imageModel: string | null;
  imageAspectRatio: string | null;
  apiKeys: string;
  updatedAt: string;
};

/**
 * Keys are sealed with the instance's AES key when the installer set one.
 * Local dev has no CF_GRANT_KEY, so it falls back to a plain prefix.
 */
async function sealKeys(env: Env, keys: ApiKeys): Promise<string> {
  const json = JSON.stringify(keys);
  if (!env.CF_GRANT_KEY) return `plain:${json}`;
  const { ciphertext, iv } = await encrypt(env, json);
  return `aes:${iv}:${ciphertext}`;
}

async function openKeys(env: Env, sealed: string): Promise<ApiKeys> {
  try {
    if (sealed.startsWith("plain:")) return JSON.parse(sealed.slice(6)) as ApiKeys;
    if (sealed.startsWith("aes:")) {
      const [, iv, ciphertext] = sealed.split(":");
      return JSON.parse(await decrypt(env, ciphertext, iv)) as ApiKeys;
    }
  } catch {
    // A rotated instance key makes old keys unreadable; treat them as removed.
  }
  return {};
}

function maskApiKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

function resolveImageModel(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed || DEFAULT_IMAGE_MODEL;
}

function resolveImageAspectRatio(value: string | null | undefined): (typeof IMAGE_ASPECT_RATIOS)[number] {
  const trimmed = value?.trim();
  if (trimmed && isImageAspectRatio(trimmed)) return trimmed;
  return DEFAULT_IMAGE_ASPECT_RATIO;
}

function toView(
  activeProvider: LlmProviderId,
  model: string,
  imageModel: string,
  imageAspectRatio: (typeof IMAGE_ASPECT_RATIOS)[number],
  keys: ApiKeys,
  updatedAt: string | null,
): LlmSettingsView {
  const configuredProviders = {} as Record<LlmProviderId, boolean>;
  const maskedApiKeys: Partial<Record<LlmProviderId, string>> = {};
  for (const id of LLM_PROVIDER_IDS) {
    const key = keys[id]?.trim();
    configuredProviders[id] = Boolean(key);
    if (key) maskedApiKeys[id] = maskApiKey(key);
  }
  return { activeProvider, model, imageModel, imageAspectRatio, updatedAt, configuredProviders, maskedApiKeys };
}

async function loadSettings(env: Env, userId: string) {
  const row = await env.DB.prepare(
    `SELECT active_provider as activeProvider, model, image_model as imageModel, image_aspect_ratio as imageAspectRatio,
            api_keys as apiKeys, updated_at as updatedAt FROM llm_settings WHERE user_id = ?`,
  )
    .bind(userId)
    .first<SettingsRow>();
  if (!row) {
    return {
      activeProvider: DEFAULT_LLM_PROVIDER,
      model: DEFAULT_LLM_MODEL,
      imageModel: DEFAULT_IMAGE_MODEL,
      imageAspectRatio: DEFAULT_IMAGE_ASPECT_RATIO,
      keys: {} as ApiKeys,
      updatedAt: null,
    };
  }
  return {
    activeProvider: isLlmProviderId(row.activeProvider) ? row.activeProvider : DEFAULT_LLM_PROVIDER,
    model: row.model || DEFAULT_LLM_MODEL,
    imageModel: resolveImageModel(row.imageModel),
    imageAspectRatio: resolveImageAspectRatio(row.imageAspectRatio),
    keys: await openKeys(env, row.apiKeys),
    updatedAt: row.updatedAt,
  };
}

const providerSchema = z.enum(LLM_PROVIDER_IDS as [LlmProviderId, ...LlmProviderId[]]);

const SYSTEM_PROMPT = `You are the writing assistant inside Dotnote, a Markdown notes app. The user selects text in a note, or places the cursor, and tells you what to do.

Reply with only the text that should go into the note, written as Markdown. Do not add a preamble, closing remarks, or notes about what you changed, and do not wrap the whole reply in a code block.

When <selection> is inline text from one block, your reply replaces exactly that text: reply with inline text only, without headings or list markers, unless the instruction asks for more structure.
When <selection> is whole blocks, your reply replaces those blocks: keep their structure (headings, lists, numbering) unless the instruction asks you to change it.
When there is no selection, your reply is inserted after the block in <cursor_block>.
Never repeat note text that is outside the selection.

Write in the language of the selection, or of the note when nothing is selected, unless the instruction asks for another language.
If the instruction is a question about the note rather than a request to write, answer it briefly in Markdown.`;

const generateSchema = z.object({
  document: z.string().max(1_000_000).optional(),
  selection: z
    .object({ kind: z.enum(["inline", "blocks"]), markdown: z.string().max(400_000) })
    .optional(),
  cursorBlock: z.string().max(100_000).optional(),
  turns: z
    .array(z.object({ instruction: z.string().min(1).max(8_000), output: z.string().max(400_000).optional() }))
    .min(1)
    .max(20),
});

type GenerateInput = z.infer<typeof generateSchema>;

function buildMessages(input: GenerateInput): LlmChatMessage[] {
  const context: string[] = [];
  if (input.document) context.push(`<note>\n${input.document}\n</note>`);
  if (input.selection) {
    context.push(`<selection kind="${input.selection.kind}">\n${input.selection.markdown}\n</selection>`);
  } else if (input.cursorBlock !== undefined) {
    context.push(`<cursor_block>\n${input.cursorBlock}\n</cursor_block>`);
  }
  const messages: LlmChatMessage[] = [];
  input.turns.forEach((turn, index) => {
    const instruction = `<instruction>\n${turn.instruction}\n</instruction>`;
    messages.push({
      role: "user",
      content: index === 0 ? [...context, instruction].join("\n\n") : instruction,
    });
    if (turn.output !== undefined) messages.push({ role: "assistant", content: turn.output });
  });
  return messages;
}

class ProviderError extends Error {}

/** Claude models that accept `output_config.effort`; others reject it with a 400. */
function supportsEffort(model: string): boolean {
  const id = model.trim().toLowerCase();
  if (/^claude-(fable|mythos)(?:-|$)/.test(id)) return true;
  const match = /^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d+))?/.exec(id);
  if (!match) return false;
  const [, family, majorRaw, minorRaw] = match;
  const version = Number(majorRaw) + Number(minorRaw ?? 0) / 10;
  if (family === "opus") return version >= 4.5;
  if (family === "sonnet") return version >= 4.6;
  return version >= 5.5;
}

async function* streamAnthropic(apiKey: string, model: string, messages: LlmChatMessage[], signal: AbortSignal) {
  const client = new Anthropic({ apiKey, maxRetries: 1 });
  try {
    const stream = client.beta.messages.stream(
      {
        model,
        max_tokens: 32_000,
        system: SYSTEM_PROMPT,
        messages,
        // Editing prose is a light task; low effort keeps replies quick, and thinking stays off.
        ...(supportsEffort(model) ? { output_config: { effort: "low" as const } } : {}),
        ...(thinkingControlFor("anthropic", model) === "disable-param"
          ? { thinking: { type: "disabled" as const } }
          : {}),
        // On a policy decline, retry on the model's default fallback; a no-op where unsupported.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      },
      { signal },
    );
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield event.delta.text;
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") throw new ProviderError("The model declined this request.");
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if (err instanceof Anthropic.AuthenticationError) throw new ProviderError("Anthropic rejected the API key.");
    if (err instanceof Anthropic.PermissionDeniedError) throw new ProviderError("This Anthropic key cannot use that model.");
    if (err instanceof Anthropic.NotFoundError) throw new ProviderError(`Anthropic has no model “${model}”.`);
    if (err instanceof Anthropic.RateLimitError) throw new ProviderError("Anthropic rate limit reached. Try again shortly.");
    if (err instanceof Anthropic.APIError) throw new ProviderError(`Anthropic error: ${err.message}`);
    throw err;
  }
}

/** Parse a `text/event-stream` body into the JSON payload of each `data:` line. */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        yield JSON.parse(data);
      } catch {
        // Skip keep-alive or partial lines.
      }
    }
  }
}

async function providerFailure(name: string, res: Response): Promise<ProviderError> {
  const text = await res.text().catch(() => "");
  let detail = text.slice(0, 300);
  try {
    const body = JSON.parse(text) as { error?: { message?: string } | string };
    detail = typeof body.error === "string" ? body.error : (body.error?.message ?? detail);
  } catch {
    // keep raw text
  }
  if (res.status === 401 || res.status === 403) return new ProviderError(`${name} rejected the API key.`);
  return new ProviderError(`${name} error ${res.status}${detail ? `: ${detail}` : ""}`);
}

/** OpenAI and xAI both serve the Chat Completions streaming shape. */
function chatCompletionsExtras(provider: "openai" | "xai", model: string): Record<string, unknown> {
  if (thinkingControlFor(provider, model) !== "effort-none") return {};
  // "none" is the off switch. Models that cannot accept it are marked non-reasoning-only and skip this.
  return { reasoning_effort: "none" };
}

async function* streamChatCompletions(
  name: string,
  url: string,
  apiKey: string,
  model: string,
  messages: LlmChatMessage[],
  signal: AbortSignal,
  extras: Record<string, unknown>,
) {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      ...extras,
    }),
    signal,
  });
  if (!res.ok || !res.body) throw await providerFailure(name, res);
  for await (const chunk of sseData(res.body)) {
    const text = (chunk as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content;
    if (text) yield text;
  }
}

/** Gemini 2.5 accepts a zero budget. Gemini 3 rejects that field and uses a level instead. */
function geminiThinkingOff(model: string): Record<string, unknown> {
  if (/^gemini-2\.5-/.test(model)) return { thinkingBudget: 0 };
  return { thinkingLevel: "MINIMAL" };
}

type GeminiTextPart = { text?: string; thought?: boolean };

async function* streamGemini(apiKey: string, model: string, messages: LlmChatMessage[], signal: AbortSignal) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  const thinking =
    thinkingControlFor("gemini", model) === "disable-param" ? { thinkingConfig: geminiThinkingOff(model) } : undefined;
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      ...(thinking ? { generationConfig: thinking } : {}),
    }),
    signal,
  });
  if (!res.ok || !res.body) throw await providerFailure("Gemini", res);
  for await (const chunk of sseData(res.body)) {
    const parts = (chunk as { candidates?: { content?: { parts?: GeminiTextPart[] } }[] }).candidates?.[0]?.content
      ?.parts;
    for (const part of parts ?? []) {
      if (part.thought) continue;
      if (part.text) yield part.text;
    }
  }
}

function streamProvider(
  provider: LlmProviderId,
  apiKey: string,
  model: string,
  messages: LlmChatMessage[],
  signal: AbortSignal,
): AsyncGenerator<string> {
  switch (provider) {
    case "anthropic":
      return streamAnthropic(apiKey, model, messages, signal);
    case "openai":
      return streamChatCompletions(
        "OpenAI",
        "https://api.openai.com/v1/chat/completions",
        apiKey,
        model,
        messages,
        signal,
        chatCompletionsExtras("openai", model),
      );
    case "xai":
      return streamChatCompletions(
        "xAI",
        "https://api.x.ai/v1/chat/completions",
        apiKey,
        model,
        messages,
        signal,
        chatCompletionsExtras("xai", model),
      );
    case "gemini":
      return streamGemini(apiKey, model, messages, signal);
  }
}

export const llmRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

llmRoutes.get("/settings", async (c) => {
  const s = await loadSettings(c.env, c.get("user").id);
  return c.json({
    settings: toView(s.activeProvider, s.model, s.imageModel, s.imageAspectRatio, s.keys, s.updatedAt),
  });
});

llmRoutes.patch(
  "/settings",
  zValidator(
    "json",
    z.object({
      activeProvider: providerSchema.optional(),
      model: z.string().min(1).max(120).optional(),
      imageModel: z.string().min(1).max(120).optional(),
      imageAspectRatio: z.enum(IMAGE_ASPECT_RATIOS).optional(),
      apiKeys: z.record(providerSchema, z.string().max(400)).optional(),
    }),
  ),
  async (c) => {
    const user = c.get("user");
    const patch = c.req.valid("json");
    const current = await loadSettings(c.env, user.id);
    const keys: ApiKeys = { ...current.keys };
    for (const [provider, value] of Object.entries(patch.apiKeys ?? {}) as [LlmProviderId, string][]) {
      const trimmed = value.trim();
      if (trimmed) keys[provider] = trimmed;
      else delete keys[provider];
    }
    const activeProvider = patch.activeProvider ?? current.activeProvider;
    const model = patch.model?.trim() || current.model;
    const imageModel = patch.imageModel?.trim() || current.imageModel;
    const imageAspectRatio = patch.imageAspectRatio ?? current.imageAspectRatio;
    const updatedAt = new Date().toISOString();
    await c.env.DB.prepare(
      `INSERT INTO llm_settings (user_id, active_provider, model, image_model, image_aspect_ratio, api_keys, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET active_provider = excluded.active_provider, model = excluded.model,
         image_model = excluded.image_model, image_aspect_ratio = excluded.image_aspect_ratio,
         api_keys = excluded.api_keys, updated_at = excluded.updated_at`,
    )
      .bind(user.id, activeProvider, model, imageModel, imageAspectRatio, await sealKeys(c.env, keys), updatedAt)
      .run();
    return c.json({
      settings: toView(activeProvider, model, imageModel, imageAspectRatio, keys, updatedAt),
    });
  },
);

const imageGenerateSchema = z.object({
  prompt: z.string().min(1).max(4_000),
  context: z.string().max(200_000).optional(),
  sourceImage: z
    .object({
      mimeType: z.enum(IMAGE_INPUT_MIME_TYPES),
      dataBase64: z.string().min(1).max(14_000_000),
    })
    .optional(),
});

type GeminiImagePart = { inlineData?: { mimeType?: string; data?: string }; text?: string };

function imagePromptText(prompt: string, context: string | undefined, hasSource: boolean): string {
  const parts: string[] = [];
  if (context?.trim()) parts.push(`Context from the user's note:\n${context.trim()}`);
  parts.push(
    hasSource
      ? `Edit the attached image to match this description:\n${prompt.trim()}`
      : `Create an image for this description:\n${prompt.trim()}`,
  );
  return parts.join("\n\n");
}

async function generateGeminiImage(
  apiKey: string,
  model: string,
  aspectRatio: string,
  prompt: string,
  context: string | undefined,
  sourceImage: AiSourceImagePayload | undefined,
  signal: AbortSignal,
): Promise<{ mimeType: string; dataBase64: string; caption?: string }> {
  const userParts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
  if (sourceImage) {
    userParts.push({ inlineData: { mimeType: sourceImage.mimeType, data: sourceImage.dataBase64 } });
  }
  userParts.push({ text: imagePromptText(prompt, context, Boolean(sourceImage)) });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: userParts }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio },
      },
    }),
    signal,
  });
  if (!res.ok) throw await providerFailure("Gemini", res);
  const body = (await res.json()) as {
    candidates?: { content?: { parts?: GeminiImagePart[] } }[];
  };
  let caption: string | undefined;
  let mimeType: string | undefined;
  let dataBase64: string | undefined;
  for (const part of body.candidates?.[0]?.content?.parts ?? []) {
    if (part.text?.trim()) caption = part.text.trim();
    if (part.inlineData?.data) {
      mimeType = part.inlineData.mimeType || "image/png";
      dataBase64 = part.inlineData.data;
    }
  }
  if (!dataBase64 || !mimeType) {
    throw new ProviderError("Gemini did not return an image. Try rephrasing the prompt or switching models.");
  }
  return { mimeType, dataBase64, caption };
}

function resolveOpenAiImageSize(model: string, aspectRatio: string): "1024x1024" | "1792x1024" | "1024x1792" {
  if (model === "dall-e-3") {
    if (aspectRatio === "16:9" || aspectRatio === "4:3") return "1792x1024";
    if (aspectRatio === "9:16" || aspectRatio === "3:4") return "1024x1792";
  }
  return "1024x1024";
}

async function generateOpenAiImage(
  apiKey: string,
  model: string,
  aspectRatio: string,
  prompt: string,
  context: string | undefined,
  sourceImage: AiSourceImagePayload | undefined,
  signal: AbortSignal,
): Promise<{ mimeType: string; dataBase64: string; caption?: string }> {
  const promptText = imagePromptText(prompt, context, Boolean(sourceImage));
  if (sourceImage) {
    if (model !== "dall-e-2") throw new ProviderError("image_input_unsupported");
    const binary = atob(sourceImage.dataBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const ext = sourceImage.mimeType === "image/jpeg" ? "jpg" : sourceImage.mimeType === "image/webp" ? "webp" : "png";
    const form = new FormData();
    form.set("model", model);
    form.set("prompt", promptText);
    form.set("n", "1");
    form.set("size", "1024x1024");
    form.set("response_format", "b64_json");
    form.set("image", new File([bytes], `source.${ext}`, { type: sourceImage.mimeType }));
    const res = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal,
    });
    if (!res.ok) throw await providerFailure("OpenAI", res);
    const body = (await res.json()) as { data?: { b64_json?: string; revised_prompt?: string }[] };
    const item = body.data?.[0];
    if (!item?.b64_json) {
      throw new ProviderError("OpenAI did not return an image. Try rephrasing the prompt or switching models.");
    }
    return { mimeType: "image/png", dataBase64: item.b64_json, caption: item.revised_prompt?.trim() || undefined };
  }
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: promptText,
      size: resolveOpenAiImageSize(model, aspectRatio),
      response_format: "b64_json",
      n: 1,
    }),
    signal,
  });
  if (!res.ok) throw await providerFailure("OpenAI", res);
  const body = (await res.json()) as { data?: { b64_json?: string; revised_prompt?: string }[] };
  const item = body.data?.[0];
  if (!item?.b64_json) {
    throw new ProviderError("OpenAI did not return an image. Try rephrasing the prompt or switching models.");
  }
  return {
    mimeType: "image/png",
    dataBase64: item.b64_json,
    caption: item.revised_prompt?.trim() || undefined,
  };
}

llmRoutes.post("/images/generate", zValidator("json", imageGenerateSchema), async (c) => {
  const input = c.req.valid("json");
  const s = await loadSettings(c.env, c.get("user").id);
  const provider = getImageModelProvider(s.imageModel);
  const modelMeta = findImageModel(s.imageModel);
  if (input.sourceImage && modelMeta && !modelMeta.supportsImageInput) {
    return c.json({ error: "image_input_unsupported" }, 400);
  }
  const apiKey = s.keys[provider]?.trim();
  if (!apiKey) return c.json({ error: `no_${provider}_key` }, 400);

  const upstream = new AbortController();
  c.req.raw.signal?.addEventListener("abort", () => upstream.abort());
  try {
    const result =
      provider === "openai"
        ? await generateOpenAiImage(
            apiKey,
            s.imageModel,
            s.imageAspectRatio,
            input.prompt,
            input.context,
            input.sourceImage,
            upstream.signal,
          )
        : await generateGeminiImage(
            apiKey,
            s.imageModel,
            s.imageAspectRatio,
            input.prompt,
            input.context,
            input.sourceImage,
            upstream.signal,
          );
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Image generation failed.";
    const status = message === "image_input_unsupported" ? 400 : err instanceof ProviderError && message.includes("rate") ? 429 : 502;
    return c.json({ error: message }, status);
  }
});

llmRoutes.post("/generate", zValidator("json", generateSchema), async (c) => {
  const input = c.req.valid("json");
  const s = await loadSettings(c.env, c.get("user").id);
  if (thinkingControlFor(s.activeProvider, s.model) === "always-on") {
    return c.json({ error: "thinking_required" }, 400);
  }
  const apiKey = s.keys[s.activeProvider]?.trim();
  if (!apiKey) return c.json({ error: "no_api_key" }, 400);

  const messages = buildMessages(input);
  const upstream = new AbortController();
  c.req.raw.signal?.addEventListener("abort", () => upstream.abort());
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: LlmStreamEvent) => {
        if (!upstream.signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        for await (const text of streamProvider(s.activeProvider, apiKey, s.model, messages, upstream.signal)) {
          send({ type: "text", text });
        }
        send({ type: "done" });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "The AI request failed." });
      } finally {
        if (!upstream.signal.aborted) controller.close();
      }
    },
    cancel() {
      upstream.abort();
    },
  });

  return new Response(body, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
});

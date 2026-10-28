import { getImageModelProvider } from "./llm";

/** OpenAI Images API prompt length limits (characters). */
const OPENAI_IMAGE_PROMPT_MAX: Record<string, number> = {
  "dall-e-3": 4_000,
  "dall-e-2": 1_000,
};

/** Extra room for Gemini image requests (much higher upstream; keep prompts focused). */
const GEMINI_CONTEXT_MAX = 2_400;

export function openAiImagePromptLimit(modelId: string): number {
  return OPENAI_IMAGE_PROMPT_MAX[modelId] ?? 4_000;
}

export type ImageNoteContextInput = {
  selectionMarkdown?: string;
  cursorBlock?: string;
  document?: string;
};

/** Note excerpt sent with image jobs — selection or nearby text only, never the full document. */
export function pickImageNoteContext(input: ImageNoteContextInput): string | undefined {
  const selection = input.selectionMarkdown?.trim();
  if (selection) return compactVisualContext(selection, 1_200);

  const cursor = input.cursorBlock?.trim();
  if (cursor) return compactVisualContext(cursor, 800);

  const doc = input.document?.trim();
  if (!doc) return undefined;
  const firstBlock = doc.split(/\n{2,}/)[0]?.trim() ?? doc;
  return compactVisualContext(firstBlock, 400);
}

/** Drop code, links, and headings so context reads like an image brief. */
export function compactVisualContext(raw: string, maxLen: number): string {
  let s = raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

function fitPrompt(text: string, maxLen: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

/**
 * Final text sent to Gemini or OpenAI image endpoints.
 * User description comes first; note context is optional mood/subject hints only.
 */
export function buildImageGenerationPrompt(opts: {
  prompt: string;
  context?: string;
  hasSource: boolean;
  modelId: string;
}): string {
  const userPrompt = opts.prompt.trim();
  const provider = getImageModelProvider(opts.modelId);
  const context = opts.context?.trim();

  if (opts.hasSource) {
    const editLead = "Apply this change to the attached image:";
    if (provider === "openai") {
      const limit = openAiImagePromptLimit(opts.modelId);
      const core = `${editLead} ${userPrompt}`;
      if (!context) return fitPrompt(core, limit);
      const room = limit - core.length - 4;
      if (room < 40) return fitPrompt(core, limit);
      const hint = compactVisualContext(context, Math.min(room, 400));
      return fitPrompt(`${core} Context: ${hint}`, limit);
    }
    const parts: string[] = [];
    if (context) {
      parts.push(
        `Reference from the user's note (style and subject only):\n${compactVisualContext(context, GEMINI_CONTEXT_MAX)}`,
      );
    }
    parts.push(`${editLead}\n${userPrompt}`);
    return parts.join("\n\n");
  }

  if (provider === "openai") {
    const limit = openAiImagePromptLimit(opts.modelId);
    if (!context) return fitPrompt(userPrompt, limit);
    const room = limit - userPrompt.length - 4;
    if (room < 40) return fitPrompt(userPrompt, limit);
    const hint = compactVisualContext(context, Math.min(room - 28, 500));
    if (!hint) return fitPrompt(userPrompt, limit);
    return fitPrompt(`${userPrompt}. Mood and setting from the user's note: ${hint}`, limit);
  }

  const parts: string[] = [];
  if (context) {
    parts.push(
      `Visual context from the user's note (mood, palette, and subject only — do not render note text as typography unless the prompt asks):\n${compactVisualContext(context, GEMINI_CONTEXT_MAX)}`,
    );
  }
  parts.push(`Image to generate:\n${userPrompt}`);
  return parts.join("\n\n");
}

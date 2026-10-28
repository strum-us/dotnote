export type LlmProviderId = "anthropic" | "openai" | "xai" | "gemini";

/**
 * How a text model treats hidden reasoning.
 * Notes are not a coding task, so the Worker refuses `always-on` models and
 * sends the off switch for every other kind. There is no client toggle.
 */
export type ThinkingControl =
  | "disable-param"
  | "effort-none"
  | "non-reasoning-only"
  | "always-on";

export type LlmModelOption = {
  id: string;
  label: string;
  inputPer1MUsd: number;
  outputPer1MUsd: number;
  contextTokens?: number;
  notes?: string;
  thinking: ThinkingControl;
};

export type LlmProviderMeta = {
  id: LlmProviderId;
  name: string;
  docsUrl: string;
};

export const LLM_PROVIDER_META: LlmProviderMeta[] = [
  { id: "anthropic", name: "Anthropic", docsUrl: "https://console.anthropic.com/settings/keys" },
  { id: "openai", name: "OpenAI", docsUrl: "https://platform.openai.com/api-keys" },
  { id: "xai", name: "xAI", docsUrl: "https://console.x.ai/" },
  { id: "gemini", name: "Google Gemini", docsUrl: "https://aistudio.google.com/apikey" },
];

export const LLM_PROVIDER_IDS = LLM_PROVIDER_META.map((p) => p.id);

export function isLlmProviderId(value: string): value is LlmProviderId {
  return (LLM_PROVIDER_IDS as string[]).includes(value);
}

export function getLlmProviderMeta(id: LlmProviderId): LlmProviderMeta {
  return LLM_PROVIDER_META.find((p) => p.id === id) ?? LLM_PROVIDER_META[0];
}

/**
 * Model picker catalog, ported from tablepad without retired ids or aliases.
 * Anthropic list: Claude models table cached 2026-10-06. Other providers:
 * tablepad audit of 2026-08-13 against each provider's pricing docs.
 */
export const LLM_MODEL_CATALOG: Record<LlmProviderId, LlmModelOption[]> = {
  anthropic: [
    {
      id: "claude-opus-5-5",
      label: "Claude Opus 5.5",
      inputPer1MUsd: 4.0,
      outputPer1MUsd: 20.0,
      contextTokens: 1_000_000,
      notes: "Current Opus · recommended default",
      thinking: "disable-param",
    },
    {
      id: "claude-fable-5-1",
      label: "Claude Fable 5.1",
      inputPer1MUsd: 10.0,
      outputPer1MUsd: 50.0,
      contextTokens: 1_000_000,
      notes: "Most capable widely released Claude",
      thinking: "disable-param",
    },
    {
      id: "claude-sonnet-5-5",
      label: "Claude Sonnet 5.5",
      inputPer1MUsd: 2.0,
      outputPer1MUsd: 10.0,
      contextTokens: 1_000_000,
      notes: "Current Sonnet · speed and capability",
      thinking: "disable-param",
    },
    {
      id: "claude-haiku-5-5",
      label: "Claude Haiku 5.5",
      inputPer1MUsd: 0.1,
      outputPer1MUsd: 0.5,
      contextTokens: 1_000_000,
      notes: "Current Haiku · fastest and cheapest",
      thinking: "disable-param",
    },
    { id: "claude-fable-5", label: "Claude Fable 5", inputPer1MUsd: 10.0, outputPer1MUsd: 50.0, contextTokens: 1_000_000, thinking: "disable-param" },
    { id: "claude-opus-5", label: "Claude Opus 5", inputPer1MUsd: 5.0, outputPer1MUsd: 25.0, contextTokens: 1_000_000, thinking: "disable-param" },
    { id: "claude-opus-4-8", label: "Claude Opus 4.8", inputPer1MUsd: 5.0, outputPer1MUsd: 25.0, contextTokens: 1_000_000, thinking: "disable-param" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5", inputPer1MUsd: 2.0, outputPer1MUsd: 10.0, contextTokens: 1_000_000, thinking: "disable-param" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", inputPer1MUsd: 3.0, outputPer1MUsd: 15.0, contextTokens: 1_000_000, thinking: "disable-param" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", inputPer1MUsd: 1.0, outputPer1MUsd: 5.0, contextTokens: 200_000, thinking: "non-reasoning-only" },
  ],
  openai: [
    {
      id: "gpt-5.6-sol",
      label: "GPT-5.6 Sol",
      inputPer1MUsd: 5.0,
      outputPer1MUsd: 30.0,
      contextTokens: 1_050_000,
      notes: "Current flagship",
      thinking: "effort-none",
    },
    {
      id: "gpt-5.6-terra",
      label: "GPT-5.6 Terra",
      inputPer1MUsd: 2.0,
      outputPer1MUsd: 12.0,
      contextTokens: 1_050_000,
      notes: "Balanced intelligence / cost",
      thinking: "effort-none",
    },
    {
      id: "gpt-5.6-luna",
      label: "GPT-5.6 Luna",
      inputPer1MUsd: 0.2,
      outputPer1MUsd: 1.2,
      contextTokens: 1_050_000,
      notes: "Cost-efficient high-volume",
      thinking: "effort-none",
    },
    { id: "gpt-5.5", label: "GPT-5.5", inputPer1MUsd: 5.0, outputPer1MUsd: 30.0, contextTokens: 1_000_000, thinking: "effort-none" },
    { id: "gpt-5.4", label: "GPT-5.4", inputPer1MUsd: 2.5, outputPer1MUsd: 15.0, contextTokens: 1_000_000, thinking: "effort-none" },
    { id: "gpt-5.4-mini", label: "GPT-5.4 mini", inputPer1MUsd: 0.75, outputPer1MUsd: 4.5, contextTokens: 400_000, thinking: "effort-none" },
    { id: "gpt-5.4-nano", label: "GPT-5.4 nano", inputPer1MUsd: 0.2, outputPer1MUsd: 1.25, contextTokens: 400_000, thinking: "effort-none" },
    { id: "gpt-4.1", label: "GPT-4.1", inputPer1MUsd: 2.0, outputPer1MUsd: 8.0, contextTokens: 1_000_000, thinking: "non-reasoning-only" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini", inputPer1MUsd: 0.4, outputPer1MUsd: 1.6, contextTokens: 1_000_000, thinking: "non-reasoning-only" },
  ],
  xai: [
    {
      id: "grok-4.6",
      label: "Grok 4.6",
      inputPer1MUsd: 2.0,
      outputPer1MUsd: 6.0,
      contextTokens: 500_000,
      notes: "Current flagship",
      thinking: "effort-none",
    },
    { id: "grok-4.5", label: "Grok 4.5", inputPer1MUsd: 2.0, outputPer1MUsd: 6.0, contextTokens: 500_000, thinking: "effort-none" },
    { id: "grok-4.3", label: "Grok 4.3", inputPer1MUsd: 1.25, outputPer1MUsd: 2.5, contextTokens: 1_000_000, thinking: "effort-none" },
    {
      id: "grok-4.20-0309-non-reasoning",
      label: "Grok 4.20 Non-reasoning",
      inputPer1MUsd: 1.25,
      outputPer1MUsd: 2.5,
      contextTokens: 1_000_000,
      thinking: "non-reasoning-only",
    },
    { id: "grok-build-0.1", label: "Grok Build 0.1", inputPer1MUsd: 1.0, outputPer1MUsd: 2.0, contextTokens: 256_000, thinking: "non-reasoning-only" },
  ],
  gemini: [
    {
      id: "gemini-3.6-flash",
      label: "Gemini 3.6 Flash",
      inputPer1MUsd: 1.5,
      outputPer1MUsd: 7.5,
      contextTokens: 1_000_000,
      notes: "Latest Flash GA",
      thinking: "disable-param",
    },
    { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", inputPer1MUsd: 1.5, outputPer1MUsd: 9.0, contextTokens: 1_000_000, thinking: "disable-param" },
    {
      id: "gemini-3.5-flash-lite",
      label: "Gemini 3.5 Flash-Lite",
      inputPer1MUsd: 0.3,
      outputPer1MUsd: 2.5,
      contextTokens: 1_000_000,
      thinking: "disable-param",
    },
    {
      id: "gemini-3.1-pro-preview",
      label: "Gemini 3.1 Pro Preview",
      inputPer1MUsd: 2.0,
      outputPer1MUsd: 12.0,
      contextTokens: 1_000_000,
      notes: "Always reasons · hidden from the note picker",
      thinking: "always-on",
    },
    {
      id: "gemini-2.5-pro",
      label: "Gemini 2.5 Pro",
      inputPer1MUsd: 1.25,
      outputPer1MUsd: 10.0,
      contextTokens: 1_000_000,
      notes: "Always reasons · hidden from the note picker",
      thinking: "always-on",
    },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", inputPer1MUsd: 0.3, outputPer1MUsd: 2.5, contextTokens: 1_000_000, thinking: "disable-param" },
  ],
};

export const DEFAULT_LLM_PROVIDER: LlmProviderId = "anthropic";
export const DEFAULT_LLM_MODEL = "claude-opus-5-5";

export function findLlmModel(provider: LlmProviderId, modelId: string): LlmModelOption | undefined {
  return LLM_MODEL_CATALOG[provider].find((m) => m.id === modelId);
}

/** Text models that can run with reasoning switched off. */
export function textModelsForProvider(provider: LlmProviderId): LlmModelOption[] {
  return LLM_MODEL_CATALOG[provider].filter((m) => m.thinking !== "always-on");
}

/** Catalog value, or a conservative guess for an id that is not listed. */
export function thinkingControlFor(provider: LlmProviderId, modelId: string): ThinkingControl {
  const listed = findLlmModel(provider, modelId)?.thinking;
  if (listed) return listed;
  const id = modelId.trim().toLowerCase();
  if (provider === "openai") return id.startsWith("gpt-5") ? "effort-none" : "non-reasoning-only";
  if (provider === "xai") {
    return id.includes("non-reasoning") || id.includes("build") ? "non-reasoning-only" : "effort-none";
  }
  if (provider === "gemini") return id.includes("pro") ? "always-on" : "disable-param";
  if (/^claude-(fable|mythos)(?:-|$)/.test(id)) return "disable-param";
  const match = /^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d+))?/.exec(id);
  if (!match) return "non-reasoning-only";
  const [, family, majorRaw, minorRaw] = match;
  const version = Number(majorRaw) + Number(minorRaw ?? 0) / 10;
  if (family === "opus") return version >= 4.5 ? "disable-param" : "non-reasoning-only";
  if (family === "sonnet") return version >= 4.6 ? "disable-param" : "non-reasoning-only";
  return version >= 5.5 ? "disable-param" : "non-reasoning-only";
}

function formatUsdPer1M(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 1 ? (Number.isInteger(value) ? 0 : 2) : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Compact in/out pricing for model pickers, e.g. `$5 / $30`. */
export function formatLlmModelPrice(model: Pick<LlmModelOption, "inputPer1MUsd" | "outputPer1MUsd">): string {
  return `${formatUsdPer1M(model.inputPer1MUsd)} / ${formatUsdPer1M(model.outputPer1MUsd)}`;
}

/** Short label for chips, e.g. `Claude Opus 5.5` → `Opus 5.5`. */
export function compactModelLabel(provider: LlmProviderId, modelId: string): string {
  const label = findLlmModel(provider, modelId)?.label;
  if (!label) return modelId.replace(/^claude-/, "");
  return label.replace(/^Claude /, "");
}

/** What the client sees; raw keys never leave the Worker. */
export const IMAGE_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const;
export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];

export const DEFAULT_IMAGE_MODEL = "gemini-2.5-flash-image";
export const DEFAULT_IMAGE_ASPECT_RATIO: ImageAspectRatio = "16:9";

export type ImageModelOption = {
  id: string;
  label: string;
  provider: LlmProviderId;
  /** True when the model can take an existing image as input. */
  supportsImageInput: boolean;
  notes?: string;
};

export const IMAGE_INPUT_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type ImageInputMimeType = (typeof IMAGE_INPUT_MIME_TYPES)[number];

export type AiSourceImagePayload = {
  mimeType: ImageInputMimeType;
  dataBase64: string;
};

export function isImageInputMimeType(value: string): value is ImageInputMimeType {
  return (IMAGE_INPUT_MIME_TYPES as readonly string[]).includes(value);
}

export const IMAGE_MODEL_CATALOG: ImageModelOption[] = [
  {
    id: "gemini-2.5-flash-image",
    label: "Nano Banana · Gemini 2.5 Flash Image",
    provider: "gemini",
    notes: "Free tier · fast",
    supportsImageInput: true,
  },
  {
    id: "gemini-3.1-flash-image",
    label: "Gemini 3.1 Flash Image",
    provider: "gemini",
    notes: "Higher quality · may require preview access",
    supportsImageInput: true,
  },
  {
    id: "dall-e-3",
    label: "DALL·E 3",
    provider: "openai",
    notes: "OpenAI flagship · new images only",
    supportsImageInput: false,
  },
  {
    id: "dall-e-2",
    label: "DALL·E 2",
    provider: "openai",
    notes: "Square 1024×1024 · can edit an existing image",
    supportsImageInput: true,
  },
];

export function findImageModel(modelId: string): ImageModelOption | undefined {
  return IMAGE_MODEL_CATALOG.find((m) => m.id === modelId);
}

export function getImageModelProvider(modelId: string): LlmProviderId {
  return findImageModel(modelId)?.provider ?? "gemini";
}

export function isImageAspectRatio(value: string): value is ImageAspectRatio {
  return (IMAGE_ASPECT_RATIOS as readonly string[]).includes(value);
}

export type LlmSettingsView = {
  activeProvider: LlmProviderId;
  model: string;
  imageModel: string;
  imageAspectRatio: ImageAspectRatio;
  updatedAt: string | null;
  configuredProviders: Record<LlmProviderId, boolean>;
  maskedApiKeys: Partial<Record<LlmProviderId, string>>;
};

export type UpdateLlmSettings = {
  activeProvider?: LlmProviderId;
  model?: string;
  imageModel?: string;
  imageAspectRatio?: ImageAspectRatio;
  /** An empty string removes that provider's key. */
  apiKeys?: Partial<Record<LlmProviderId, string>>;
};

export type AiImageGenerateResponse = {
  mimeType: string;
  dataBase64: string;
  /** Optional caption returned by the model alongside the image. */
  caption?: string;
};

export type LlmChatMessage = { role: "user" | "assistant"; content: string };

/** One line of the `/api/llm/generate` NDJSON stream. */
export type LlmStreamEvent = { type: "text"; text: string } | { type: "error"; message: string } | { type: "done" };

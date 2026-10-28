import type { AiImageGenerateResponse, AiSourceImagePayload } from "@shared/llm";
import { ApiError } from "@/lib/api";

export type AiImageGenerateRequest = {
  prompt: string;
  /** Note or selection context for the Worker to prepend. */
  context?: string;
  sourceImage?: AiSourceImagePayload;
};

export async function generateAiImage(body: AiImageGenerateRequest, signal: AbortSignal): Promise<AiImageGenerateResponse> {
  const res = await fetch("/api/llm/images/generate", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // plain-text error body
  }
  if (!res.ok) throw new ApiError(res.status, parsed);
  return parsed as AiImageGenerateResponse;
}

function errorPayloadMessage(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const err = (parsed as { error?: unknown }).error;
  return typeof err === "string" ? err : undefined;
}

export function aiImageErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const fromBody = errorPayloadMessage(err.body);
    if (fromBody === "image_input_unsupported" || err.message === "image_input_unsupported") {
      return "This image model can't edit an existing image. Switch to a Gemini image model.";
    }
    if (fromBody) return fromBody;
    if (err.message === "no_gemini_key") {
      return "Add a Google Gemini API key in Settings → AI Image.";
    }
    if (err.message === "no_openai_key") {
      return "Add an OpenAI API key in Settings → AI or Settings → AI Image.";
    }
    if (err.status === 429) return "Image quota reached. Try again later or switch models in Settings → AI Image.";
    if (err.status === 400) return "That prompt is too long or was blocked by the image model.";
    return `Image generation failed (${err.status}).`;
  }
  return err instanceof Error ? err.message : "Image generation failed.";
}

export function base64ToBlob(dataBase64: string, mimeType: string): Blob {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

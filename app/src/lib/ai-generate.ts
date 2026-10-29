import type { LlmStreamEvent } from "@shared/llm";
import { ApiError } from "@/lib/api";
import { apiFetch } from "@/lib/api-origin";

export type AiTurn = { instruction: string; output?: string };

export type AiGenerateRequest = {
  document?: string;
  selection?: { kind: "inline" | "blocks"; markdown: string };
  cursorBlock?: string;
  turns: AiTurn[];
};

/**
 * POST to the Worker, which calls the provider with the stored key and
 * streams NDJSON events back. Resolves with the full text once done.
 */
export async function generateAi(
  body: AiGenerateRequest,
  onText: (textSoFar: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const res = await apiFetch("/api/llm/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // plain-text error body
    }
    throw new ApiError(res.status, parsed);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let output = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const event = JSON.parse(line) as LlmStreamEvent;
      if (event.type === "text") {
        output += event.text;
        onText(output);
      } else if (event.type === "error") {
        throw new Error(event.message);
      }
    }
  }
  return output;
}

export function aiErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.message === "no_api_key") return "Add an API key for the selected provider in Settings → AI.";
    if (err.message === "thinking_required") {
      return "This model always reasons, which is turned off for notes. Pick another model.";
    }
    if (err.status === 400) return "The note or instruction is too long to send to the AI.";
    return `The AI request failed (${err.status}).`;
  }
  return err instanceof Error ? err.message : "The AI request failed.";
}

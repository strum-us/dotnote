import type { User } from "@shared/types";
import { apiFetch } from "@/lib/api-origin";

export class EntrySampleError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type EntrySampleEnterResponse = {
  user: User;
  workspaceId: string;
};

export async function entrySampleEnter(): Promise<EntrySampleEnterResponse> {
  const res = await apiFetch("/api/entry-sample/enter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const code =
      typeof body === "object" && body && "error" in body ? String((body as { error: string }).error) : "request_failed";
    throw new EntrySampleError(res.status, code);
  }
  return body as EntrySampleEnterResponse;
}

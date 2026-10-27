import type {
  BackupSummary,
  CloudflareStatusResponse,
  ManifestEntry,
  NoteShareStatus,
  PublicSharePayload,
  R2CopyBatchResponse,
  R2MigrationCursor,
  R2UsageResponse,
  StoredBackup,
  TreeNode,
  AuthSetup,
  UpdateCheckResponse,
  UpdateStatusResponse,
  User,
  Workspace,
  WorkspaceManifest,
} from "@shared/types";
import type { LlmSettingsView, UpdateLlmSettings } from "@shared/llm";

export type { TreeNode };

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(typeof body === "object" && body && "error" in body ? String((body as { error: string }).error) : "request_failed");
    this.status = status;
    this.body = body;
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new ApiError(res.status, parseErrorBody(text));
  return (text ? JSON.parse(text) : null) as T;
}

function parseErrorBody(text: string): unknown {
  try {
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return text;
  }
}

export const authApi = {
  setup: () => request<AuthSetup>("/api/auth/setup"),
  me: () => request<{ user: User | null }>("/api/auth/me"),
  createAccount: (fullName: string, email: string, password: string) =>
    request<{ user: User }>("/api/auth/account", {
      method: "POST",
      body: JSON.stringify({ fullName, email, password }),
    }),
  login: (email: string, password: string) =>
    request<{ user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ user: User }>("/api/auth/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
};

export const workspaceApi = {
  list: () => request<{ workspaces: Workspace[] }>("/api/workspaces"),
  create: (name: string, options: { id?: string; seed?: boolean } = {}) =>
    request<{ workspace: Workspace }>("/api/workspaces", {
      method: "POST",
      body: JSON.stringify({ name, ...options }),
    }),
  update: (id: string, name: string) =>
    request<{ workspace: Workspace }>(`/api/workspaces/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  delete: (id: string) => request<{ ok: boolean }>(`/api/workspaces/${id}`, { method: "DELETE" }),
  tree: (id: string) => request<{ tree: TreeNode[]; rev: number }>(`/api/workspaces/${id}/tree`),
  manifest: (id: string) => request<{ manifest: WorkspaceManifest }>(`/api/workspaces/${id}/manifest`),
  createFolder: (id: string, folder: { id: string; parentPath: string; name: string }) =>
    request<{ entry: ManifestEntry; rev: number; manifest: WorkspaceManifest }>(`/api/workspaces/${id}/folders`, {
      method: "POST",
      body: JSON.stringify(folder),
    }),
  createNote: (
    id: string,
    note: { id: string; parentPath: string; content: string; historyTrigger?: "manual" | "auto" },
  ) =>
    request<{ entry: ManifestEntry; content: string; rev: number; manifest: WorkspaceManifest }>(
      `/api/workspaces/${id}/notes`,
      { method: "POST", body: JSON.stringify(note) },
    ),
  renameEntry: (id: string, entryId: string, name: string) =>
    request<{ entry: ManifestEntry; rev: number; manifest: WorkspaceManifest }>(
      `/api/workspaces/${id}/entries/${entryId}`,
      { method: "PATCH", body: JSON.stringify({ name }) },
    ),
  deleteEntry: (id: string, entryId: string) =>
    request<{ removed: number; rev: number; manifest: WorkspaceManifest }>(
      `/api/workspaces/${id}/entries/${entryId}`,
      { method: "DELETE" },
    ),
  moveEntry: (id: string, entryId: string, parentPath: string) =>
    request<{ entry: ManifestEntry; rev: number; manifest: WorkspaceManifest }>(
      `/api/workspaces/${id}/entries/${entryId}/move`,
      { method: "POST", body: JSON.stringify({ parentPath }) },
    ),
};

export const assetApi = {
  save: (
    workspaceId: string,
    notePath: string,
    filename: string,
    contentBase64: string,
    mimeType?: string,
  ) =>
    request<{ relativePath: string; markdownUrl: string }>(`/api/workspaces/${workspaceId}/assets`, {
      method: "PUT",
      body: JSON.stringify({ notePath, filename, contentBase64, mimeType }),
    }),
  saveRaw: async (
    workspaceId: string,
    notePath: string,
    filename: string,
    body: Blob,
    mimeType?: string,
  ) => {
    const params = new URLSearchParams({ notePath, filename });
    const res = await fetch(`/api/workspaces/${workspaceId}/assets/raw?${params}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": mimeType || body.type || "application/octet-stream" },
      body,
    });
    const text = await res.text();
    if (!res.ok) throw new ApiError(res.status, parseErrorBody(text));
    return (text ? JSON.parse(text) : null) as { relativePath: string; markdownUrl: string };
  },
};

export const cloudflareApi = {
  status: () => request<CloudflareStatusResponse>("/api/cloudflare/status"),
  reconnect: () => request<{ url: string }>("/api/cloudflare/reconnect", { method: "POST" }),
  checkConnection: () =>
    request<{ ok: true; accountId: string; accountName: string | null }>("/api/cloudflare/connection/check", {
      method: "POST",
    }),
  usage: () => request<R2UsageResponse>("/api/cloudflare/usage"),
  copyBatch: (payload: {
    accountId: string;
    bucketName: string;
    accessKeyId: string;
    secretAccessKey: string;
    cursor?: R2MigrationCursor;
  }) =>
    request<R2CopyBatchResponse>("/api/cloudflare/migration/copy-batch", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};

export const updateApi = {
  check: (force = false) => request<UpdateCheckResponse>(`/api/update/check${force ? "?force=1" : ""}`),
  status: () => request<UpdateStatusResponse>("/api/update/status"),
  start: (version: string) =>
    request<UpdateStatusResponse>("/api/update/start", { method: "POST", body: JSON.stringify({ version }) }),
  rollback: (version: string) =>
    request<UpdateStatusResponse>("/api/update/rollback", { method: "POST", body: JSON.stringify({ version }) }),
  step: () => request<UpdateStatusResponse>("/api/update/step", { method: "POST" }),
  retry: () => request<UpdateStatusResponse>("/api/update/retry", { method: "POST" }),
  cancel: () => request<UpdateStatusResponse>("/api/update/cancel", { method: "POST" }),
};

export const llmApi = {
  settings: () => request<{ settings: LlmSettingsView }>("/api/llm/settings"),
  update: (patch: UpdateLlmSettings) =>
    request<{ settings: LlmSettingsView }>("/api/llm/settings", { method: "PATCH", body: JSON.stringify(patch) }),
};

export const noteApi = {
  get: (workspaceId: string, noteId: string) =>
    request<{
      content: string;
      entry: { id: string; path: string; contentHash?: string; updatedAt?: string };
      rev: number;
    }>(`/api/workspaces/${workspaceId}/notes/${noteId}`),
  save: (
    workspaceId: string,
    noteId: string,
    payload: { content: string; baseHash?: string; historyTrigger?: "manual" | "auto"; parentPath?: string },
  ) =>
    request<{ contentHash: string; rev: number; entry: ManifestEntry }>(`/api/workspaces/${workspaceId}/notes/${noteId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  history: (workspaceId: string, noteId: string) =>
    request<{ backups: BackupSummary[] }>(`/api/workspaces/${workspaceId}/notes/${noteId}/history`),
  historyItem: (workspaceId: string, noteId: string, backupId: string) =>
    request<{ backup: StoredBackup }>(`/api/workspaces/${workspaceId}/notes/${noteId}/history/${backupId}`),
  shareStatus: (workspaceId: string, noteId: string) =>
    request<NoteShareStatus>(`/api/workspaces/${workspaceId}/notes/${noteId}/share`),
  createShare: (workspaceId: string, noteId: string) =>
    request<NoteShareStatus>(`/api/workspaces/${workspaceId}/notes/${noteId}/share`, { method: "POST" }),
  revokeShare: (workspaceId: string, noteId: string) =>
    request<{ active: false }>(`/api/workspaces/${workspaceId}/notes/${noteId}/share`, { method: "DELETE" }),
};

export async function publicShareGet(token: string): Promise<PublicSharePayload> {
  const res = await fetch(`/api/public/shares/${encodeURIComponent(token)}`);
  const text = await res.text();
  if (!res.ok) throw new ApiError(res.status, parseErrorBody(text));
  return JSON.parse(text) as PublicSharePayload;
}

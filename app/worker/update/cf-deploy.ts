/**
 * The part of installer/worker/cf-api.ts a Dotnote needs to redeploy itself.
 * There is no shared package between app and installer: when the installer's
 * upload calls change (asset sessions, script upload, secrets), change them here too.
 */

export class CfApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
  ) {
    super(message);
  }
}

type Envelope<T> = {
  success?: boolean;
  errors?: { code?: number; message?: string }[];
  result: T;
};

const API = "https://api.cloudflare.com/client/v4";

async function readEnvelope<T>(res: Response, fallback: string): Promise<Envelope<T>> {
  const text = await res.text();
  let json: Envelope<T>;
  try {
    json = JSON.parse(text) as Envelope<T>;
  } catch {
    throw new CfApiError(text.slice(0, 300) || `${fallback} (${res.status})`, res.status);
  }
  if (!json.success) {
    const first = json.errors?.[0];
    throw new CfApiError(first?.message || `${fallback} (${res.status})`, res.status, first?.code);
  }
  return json;
}

async function cf<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const headers = new Headers({ authorization: `Bearer ${token}` });
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    headers.set("content-type", "application/json");
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API}${path}`, { method, headers, body: payload });
  return (await readEnvelope<T>(res, "Cloudflare API")).result;
}

export type ScriptBinding = { type: string; name: string; [key: string]: unknown };

export type ScriptSettings = {
  bindings?: ScriptBinding[];
  compatibility_date?: string;
  compatibility_flags?: string[];
  logpush?: boolean;
  observability?: Record<string, unknown> | null;
  tail_consumers?: { service: string; environment?: string; namespace?: string }[] | null;
};

/** Current bindings and settings of the deployed script. Secret bindings carry names only. */
export async function scriptSettings(token: string, accountId: string, scriptName: string): Promise<ScriptSettings> {
  return cf<ScriptSettings>(token, "GET", `/accounts/${accountId}/workers/scripts/${scriptName}/settings`);
}

export async function startAssetSession(
  token: string,
  accountId: string,
  scriptName: string,
  manifest: Record<string, { hash: string; size: number }>,
): Promise<{ jwt: string; buckets: string[][] }> {
  const result = await cf<{ jwt?: string; buckets?: string[][] }>(
    token,
    "POST",
    `/accounts/${accountId}/workers/scripts/${scriptName}/assets-upload-session`,
    { manifest },
  );
  if (!result.jwt) throw new CfApiError("Cloudflare did not return an asset upload token.", 502);
  return { jwt: result.jwt, buckets: result.buckets ?? [] };
}

export async function uploadAssetBucket(
  accountId: string,
  uploadJwt: string,
  parts: { hash: string; base64: string; contentType: string }[],
): Promise<string | null> {
  const form = new FormData();
  for (const part of parts) {
    form.append(part.hash, new Blob([part.base64], { type: part.contentType }));
  }
  const res = await fetch(`${API}/accounts/${accountId}/workers/assets/upload?base64=true`, {
    method: "POST",
    headers: { authorization: `Bearer ${uploadJwt}` },
    body: form,
  });
  const json = await readEnvelope<{ jwt?: string }>(res, "Asset upload failed");
  return json.result?.jwt ?? null;
}

export async function putScript(
  token: string,
  accountId: string,
  scriptName: string,
  metadata: unknown,
  source: Uint8Array<ArrayBuffer>,
): Promise<void> {
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("index.js", new Blob([source], { type: "application/javascript+module" }), "index.js");
  const res = await fetch(`${API}/accounts/${accountId}/workers/scripts/${scriptName}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  await readEnvelope<unknown>(res, "Worker upload failed");
}

export async function listSecretNames(token: string, accountId: string, scriptName: string): Promise<string[]> {
  const rows = await cf<{ name: string }[]>(token, "GET", `/accounts/${accountId}/workers/scripts/${scriptName}/secrets`);
  return (rows ?? []).map((row) => row.name);
}

export async function putSecret(
  token: string,
  accountId: string,
  scriptName: string,
  name: string,
  text: string,
): Promise<void> {
  await cf(token, "PUT", `/accounts/${accountId}/workers/scripts/${scriptName}/secrets`, {
    name,
    text,
    type: "secret_text",
  });
}

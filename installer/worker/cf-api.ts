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
  result_info?: { page?: number; total_pages?: number };
};

export function isMissing(err: unknown): boolean {
  if (!(err instanceof CfApiError)) return false;
  if (err.code === 7000 || err.code === 7003) return false;
  return err.status === 404 || err.code === 10007 || /not found|does not exist/i.test(err.message);
}

export async function cfEnvelope<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Envelope<T>> {
  const headers = new Headers({ authorization: `Bearer ${token}` });
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    headers.set("content-type", "application/json");
    payload = JSON.stringify(body);
  }
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, { method, headers, body: payload });
  const text = await res.text();
  let json: Envelope<T>;
  try {
    json = JSON.parse(text) as Envelope<T>;
  } catch {
    throw new CfApiError(text.slice(0, 300) || `Cloudflare API ${res.status}`, res.status);
  }
  if (!json.success) {
    const first = json.errors?.[0];
    throw new CfApiError(first?.message || `Cloudflare API ${res.status}`, res.status, first?.code);
  }
  return json;
}

export async function cf<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const envelope = await cfEnvelope<T>(token, method, path, body);
  return envelope.result;
}

export async function listAccounts(token: string): Promise<{ id: string; name: string }[]> {
  const rows = await cf<{ id: string; name: string }[]>(token, "GET", "/accounts?per_page=50");
  return rows ?? [];
}

export async function getAccount(token: string, accountId: string): Promise<{ id: string; name: string }> {
  return cf(token, "GET", `/accounts/${accountId}`);
}

export async function workersSubdomain(token: string, accountId: string): Promise<string | null> {
  try {
    const result = await cf<{ subdomain?: string }>(token, "GET", `/accounts/${accountId}/workers/subdomain`);
    return result.subdomain || null;
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

export async function listZones(token: string, accountId: string): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  for (let page = 1; page <= 10; page++) {
    const envelope = await cfEnvelope<{ id: string; name: string }[]>(
      token,
      "GET",
      `/zones?status=active&account.id=${accountId}&page=${page}&per_page=50`,
    );
    out.push(...(envelope.result ?? []));
    if (page >= (envelope.result_info?.total_pages ?? 1)) break;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function scriptExists(token: string, accountId: string, name: string): Promise<boolean> {
  try {
    await cf(token, "GET", `/accounts/${accountId}/workers/scripts/${name}`);
    return true;
  } catch (err) {
    if (isMissing(err)) return false;
    throw err;
  }
}

export async function findD1(token: string, accountId: string, name: string): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const envelope = await cfEnvelope<{ uuid: string; name: string }[]>(
      token,
      "GET",
      `/accounts/${accountId}/d1/database?page=${page}&per_page=100`,
    );
    const hit = (envelope.result ?? []).find((row) => row.name === name);
    if (hit) return hit.uuid;
    if (page >= (envelope.result_info?.total_pages ?? 1)) return null;
  }
  return null;
}

export async function findR2(token: string, accountId: string, name: string): Promise<boolean> {
  let cursor = "";
  for (let i = 0; i < 20; i++) {
    const path = cursor
      ? `/accounts/${accountId}/r2/buckets?cursor=${encodeURIComponent(cursor)}`
      : `/accounts/${accountId}/r2/buckets`;
    const result = await cf<{ buckets?: { name: string }[]; cursor?: string }>(token, "GET", path);
    if ((result.buckets ?? []).some((bucket) => bucket.name === name)) return true;
    if (!result.cursor || result.cursor === cursor) return false;
    cursor = result.cursor;
  }
  return false;
}

export async function hostnameConflict(
  token: string,
  zoneId: string,
  zoneName: string,
  hostname: string,
): Promise<string | null> {
  const records = await cf<{ name: string }[]>(
    token,
    "GET",
    `/zones/${zoneId}/dns_records?name=${encodeURIComponent(hostname)}&per_page=5`,
  );
  if ((records ?? []).length) return "That name already has a DNS record.";
  const wildcard = await cf<{ name: string }[]>(
    token,
    "GET",
    `/zones/${zoneId}/dns_records?name=${encodeURIComponent(`*.${zoneName}`)}&per_page=5`,
  );
  if ((wildcard ?? []).length) return "A wildcard DNS record covers that name.";
  let routes: { pattern: string }[] = [];
  try {
    routes = await cf<{ pattern: string }[]>(token, "GET", `/zones/${zoneId}/workers/routes`);
  } catch (err) {
    if (!isMissing(err)) throw err;
  }
  if ((routes ?? []).some((route) => routeCovers(route.pattern, hostname))) {
    return "A Workers route already catches that name.";
  }
  return null;
}

function routeCovers(pattern: string, hostname: string): boolean {
  const hostPart = pattern.split("/")[0]?.toLowerCase() ?? "";
  const host = hostname.toLowerCase();
  if (!hostPart || hostPart === "*") return false;
  if (hostPart === host) return true;
  if (hostPart.startsWith("*.")) return host.endsWith(hostPart.slice(1)) || host === hostPart.slice(2);
  if (hostPart.startsWith("*")) return host.endsWith(hostPart.slice(1));
  return false;
}

export async function d1Query(token: string, accountId: string, databaseId: string, sql: string): Promise<void> {
  await cf(token, "POST", `/accounts/${accountId}/d1/database/${databaseId}/query`, { sql });
}

export async function createD1(token: string, accountId: string, name: string): Promise<string> {
  const created = await cf<{ uuid: string }>(token, "POST", `/accounts/${accountId}/d1/database`, { name });
  return created.uuid;
}

export async function createR2(token: string, accountId: string, name: string): Promise<void> {
  await cf(token, "POST", `/accounts/${accountId}/r2/buckets`, { name });
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
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/assets/upload?base64=true`,
    { method: "POST", headers: { authorization: `Bearer ${uploadJwt}` }, body: form },
  );
  const json = (await res.json()) as Envelope<{ jwt?: string }>;
  if (!json.success) {
    const first = json.errors?.[0];
    throw new CfApiError(first?.message || `Asset upload failed (${res.status})`, res.status, first?.code);
  }
  return json.result?.jwt ?? null;
}

export async function putScript(
  token: string,
  accountId: string,
  scriptName: string,
  metadata: unknown,
  source: string,
): Promise<void> {
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("index.js", new Blob([source], { type: "application/javascript+module" }), "index.js");
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const json = (await res.json()) as Envelope<unknown>;
  if (!json.success) {
    const first = json.errors?.[0];
    throw new CfApiError(first?.message || `Worker upload failed (${res.status})`, res.status, first?.code);
  }
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

export async function enableSubdomain(token: string, accountId: string, scriptName: string): Promise<void> {
  await cf(token, "POST", `/accounts/${accountId}/workers/scripts/${scriptName}/subdomain`, {
    enabled: true,
    previews_enabled: false,
  });
}

export async function attachDomain(
  token: string,
  accountId: string,
  hostname: string,
  service: string,
  zoneId: string,
  zoneName: string,
): Promise<string> {
  const result = await cf<{ id: string }>(token, "PUT", `/accounts/${accountId}/workers/domains`, {
    hostname,
    service,
    enabled: true,
    zone_id: zoneId,
    zone_name: zoneName,
  });
  return result.id;
}

async function ignoreMissing(work: Promise<unknown>): Promise<void> {
  try {
    await work;
  } catch (err) {
    if (!isMissing(err)) throw err;
  }
}

export async function deleteScript(token: string, accountId: string, name: string): Promise<void> {
  await ignoreMissing(cf(token, "DELETE", `/accounts/${accountId}/workers/scripts/${name}`));
}

export async function deleteD1(token: string, accountId: string, databaseId: string): Promise<void> {
  await ignoreMissing(cf(token, "DELETE", `/accounts/${accountId}/d1/database/${databaseId}`));
}

export async function deleteR2(token: string, accountId: string, name: string): Promise<void> {
  await ignoreMissing(cf(token, "DELETE", `/accounts/${accountId}/r2/buckets/${name}`));
}

export async function deleteDomain(token: string, accountId: string, domainId: string): Promise<void> {
  await ignoreMissing(cf(token, "DELETE", `/accounts/${accountId}/workers/domains/${domainId}`));
}

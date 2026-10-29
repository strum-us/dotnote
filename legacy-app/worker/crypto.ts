function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Workers reject PBKDF2 iteration counts above 100000. */
const PBKDF2_ITERATIONS = 100_000;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return `pbkdf2:${toHex(salt.buffer)}:${toHex(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltHex, hashHex] = stored.split(":");
  if (algo !== "pbkdf2" || !saltHex || !hashHex) return false;
  const salt = new Uint8Array(saltHex.match(/.{1,2}/g)!.map((h) => parseInt(h, 16)));
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return equalHex(toHex(bits), hashHex);
}

/** A stored hash used when the email is missing, so login still runs PBKDF2. */
export const DUMMY_PASSWORD_HASH = `pbkdf2:${"00".repeat(16)}:${"11".repeat(32)}`;

function equalHex(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function randomId(): string {
  return crypto.randomUUID();
}

export function randomToken(): string {
  return crypto.randomUUID() + crypto.randomUUID();
}

export async function contentHash(content: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return toHex(buf);
}

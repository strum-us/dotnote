/**
 * Release manifests are signed with Ed25519 by scripts/pack-release.mjs; the
 * installer only serves them. A Dotnote trusts a manifest only when a key in
 * release-keys.json signed exactly the bytes it received, and trusts the
 * Worker bundle and files through the hashes in that manifest. No imports, so
 * app/test can load this file directly.
 */

export type ReleaseKey = { id: string; publicKey: string };

/** `manifest.json.sig` next to each `manifest.json`. */
export type ReleaseSignature = { keyId: string | null; signature: string };

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function parseSignature(text: string): ReleaseSignature | null {
  try {
    const raw = JSON.parse(text) as { keyId?: unknown; signature?: unknown };
    if (typeof raw.signature !== "string" || !raw.signature) return null;
    return { keyId: typeof raw.keyId === "string" ? raw.keyId : null, signature: raw.signature };
  } catch {
    return null;
  }
}

export async function verifySignature(
  keys: ReleaseKey[],
  body: Uint8Array<ArrayBuffer>,
  signature: ReleaseSignature,
): Promise<boolean> {
  let sig: Uint8Array<ArrayBuffer>;
  try {
    sig = decodeBase64(signature.signature);
  } catch {
    return false;
  }
  if (sig.byteLength !== 64) return false;
  const candidates = signature.keyId ? keys.filter((key) => key.id === signature.keyId) : keys;
  for (const entry of candidates) {
    try {
      const key = await crypto.subtle.importKey("raw", decodeBase64(entry.publicKey), { name: "Ed25519" }, false, [
        "verify",
      ]);
      if (await crypto.subtle.verify({ name: "Ed25519" }, key, sig, body)) return true;
    } catch {
      /* A malformed key in the list does not stop the others. */
    }
  }
  return false;
}

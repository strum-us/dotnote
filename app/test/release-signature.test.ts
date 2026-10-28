import assert from "node:assert/strict";
import { createHash, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { parseSignature, verifySignature, type ReleaseKey } from "../worker/update/signature.ts";

/** Signs the way scripts/pack-release.mjs does, so the two sides are checked against each other. */
function packKey() {
  const { privateKey } = generateKeyPairSync("ed25519");
  const raw = createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(-32);
  const key: ReleaseKey = {
    id: createHash("sha256").update(raw).digest("hex").slice(0, 16),
    publicKey: raw.toString("base64"),
  };
  const signatureFile = (bytes: Uint8Array) =>
    JSON.stringify({ keyId: key.id, signature: sign(null, bytes, privateKey).toString("base64") });
  return { key, signatureFile };
}

const manifest = new TextEncoder().encode(JSON.stringify({ version: "0.2.4", workerSha256: "ab".repeat(32) }));

test("a manifest signed by a listed key verifies", async () => {
  const { key, signatureFile } = packKey();
  const signature = parseSignature(signatureFile(manifest));
  assert.ok(signature);
  assert.equal(await verifySignature([key], manifest, signature), true);
});

test("one changed byte fails", async () => {
  const { key, signatureFile } = packKey();
  const signature = parseSignature(signatureFile(manifest))!;
  const tampered = manifest.slice();
  tampered[tampered.length - 3] ^= 1;
  assert.equal(await verifySignature([key], tampered, signature), false);
});

test("a key that is not listed fails, even under a listed key id", async () => {
  const trusted = packKey();
  const stranger = packKey();
  const signature = parseSignature(stranger.signatureFile(manifest))!;
  assert.equal(await verifySignature([trusted.key], manifest, signature), false);
  assert.equal(await verifySignature([trusted.key], manifest, { ...signature, keyId: trusted.key.id }), false);
});

test("rotation: any listed key may sign, and a broken entry does not stop the rest", async () => {
  const old = packKey();
  const current = packKey();
  const signature = parseSignature(current.signatureFile(manifest))!;
  const broken: ReleaseKey = { id: "broken", publicKey: "not base64!" };
  assert.equal(await verifySignature([broken, old.key, current.key], manifest, { ...signature, keyId: null }), true);
});

test("malformed signature files are rejected", async () => {
  const { key } = packKey();
  assert.equal(parseSignature("not json"), null);
  assert.equal(parseSignature(JSON.stringify({ keyId: key.id })), null);
  const short = { keyId: key.id, signature: Buffer.from("short").toString("base64") };
  assert.equal(await verifySignature([key], manifest, short), false);
});

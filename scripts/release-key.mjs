import { createHash, createPublicKey, generateKeyPairSync, createPrivateKey } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The Ed25519 key scripts/pack-release.mjs signs releases with. Creates it
 * (or reads the one already there) and lists its public half in
 * app/worker/update/release-keys.json, which the app Worker is built with.
 *
 *   node scripts/release-key.mjs [key file]
 *
 * The default key file is ~/.dotnote/release-signing-key.pem, the one
 * pack-release reads. Keep a copy somewhere safe: without it no release can
 * reach the Dotnotes built with its public key.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const keysFile = path.join(root, "app", "worker", "update", "release-keys.json");
const keyFile = path.resolve(process.argv[2] || path.join(os.homedir(), ".dotnote", "release-signing-key.pem"));

let privateKey;
if (existsSync(keyFile)) {
  privateKey = createPrivateKey(await readFile(keyFile, "utf8"));
  if (privateKey.asymmetricKeyType !== "ed25519") {
    console.error(`${keyFile} is not an Ed25519 key.`);
    process.exit(1);
  }
  console.log(`Using the key in ${keyFile}.`);
} else {
  ({ privateKey } = generateKeyPairSync("ed25519"));
  await mkdir(path.dirname(keyFile), { recursive: true, mode: 0o700 });
  await writeFile(keyFile, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
  await chmod(keyFile, 0o600);
  console.log(`Created ${keyFile}. Back it up now.`);
}

// An Ed25519 SPKI is a 12-byte header and the 32-byte key.
const raw = createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(-32);
const publicKey = raw.toString("base64");
const id = createHash("sha256").update(raw).digest("hex").slice(0, 16);

const list = JSON.parse(await readFile(keysFile, "utf8"));
if (list.keys.some((key) => key.publicKey === publicKey)) {
  console.log(`Key ${id} is already in app/worker/update/release-keys.json.`);
} else {
  list.keys.push({ id, publicKey, addedAt: new Date().toISOString().slice(0, 10) });
  await writeFile(keysFile, `${JSON.stringify(list, null, 2)}\n`);
  console.log(`Added key ${id} to app/worker/update/release-keys.json. Commit it and release: only Dotnotes built with it accept releases signed by it.`);
}

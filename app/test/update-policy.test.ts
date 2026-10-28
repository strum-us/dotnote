import assert from "node:assert/strict";
import test from "node:test";
import { automaticSkip, blockedReason, rolloutBucket, rolloutHeld, type UpdateAccess } from "../worker/update/policy.ts";

const installed = {
  INSTALLER_ORIGIN: "https://installer.example.com",
  WORKER_NAME: "dotnote",
  CF_OAUTH_CLIENT_ID: "client",
  CF_GRANT_KEY: "key",
};

const connection = {
  connected: true,
  accountId: "acc",
  scopes: ["workers-scripts.read", "workers-scripts.write"],
  updatedAt: null,
};

const grant: UpdateAccess = { credential: "grant", accountId: "acc", scriptName: "dotnote", connection };
const none: UpdateAccess = {
  credential: null,
  accountId: null,
  scriptName: "dotnote",
  connection: { ...connection, connected: false, accountId: null, scopes: [] },
};

test("an installer deploy with a full grant may update", () => {
  assert.equal(blockedReason(installed, grant), null);
});

test("an installer deploy whose handoff never landed is not_connected", () => {
  assert.equal(blockedReason(installed, none), "not_connected");
});

test("a grant without the Worker scopes is missing_scopes", () => {
  const narrow = { ...grant, connection: { ...connection, scopes: ["workers-scripts.read"] } };
  assert.equal(blockedReason(installed, narrow), "missing_scopes");
});

test("a wrangler deploy is unconfigured until the installer repairs it", () => {
  assert.equal(blockedReason({ INSTALLER_ORIGIN: installed.INSTALLER_ORIGIN, WORKER_NAME: "dotnote" }, none), "unconfigured");
});

test("local development and a missing installer always block", () => {
  assert.equal(blockedReason({ ...installed, DOTNOTE_DEV: "1" }, grant), "development");
  assert.equal(blockedReason({ ...installed, INSTALLER_ORIGIN: " " }, grant), "no_installer");
});

test("an instance joins a staged rollout once the percentage passes its bucket, and stays in", () => {
  const bucket = rolloutBucket("acc:dotnote");
  for (let percent = 0; percent <= 100; percent++) {
    const held = rolloutHeld(installed, grant, { rolloutPercent: percent }, "dotnote.example.com");
    assert.equal(held, percent < 100 && bucket >= percent);
  }
});

const ready = {
  enabled: true,
  blocked: false,
  newer: true,
  release: { autoUpdate: true },
  held: false,
  triedBefore: false,
};

test("automatic updates start only a newer, unattended, untried release", () => {
  assert.equal(automaticSkip(ready), null);
  assert.equal(automaticSkip({ ...ready, enabled: false }), "off");
  assert.equal(automaticSkip({ ...ready, blocked: true }), "blocked");
  assert.equal(automaticSkip({ ...ready, newer: false }), "up_to_date");
  assert.equal(automaticSkip({ ...ready, release: { autoUpdate: false } }), "needs_owner");
  assert.equal(automaticSkip({ ...ready, held: true }), "rollout_held");
  assert.equal(automaticSkip({ ...ready, triedBefore: true }), "tried_before");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  DIAGNOSTICS_CONSENT_VERSION,
  DIAGNOSTICS_PAYLOAD_KEYS,
  buildDiagnosticsPayload,
  diagnosticsConfigured,
  diagnosticsFingerprint,
  diagnosticsGate,
  diagnosticsUnavailableReason,
  parseDiagnosticsEnabled,
} from "../shared/diagnostics.ts";

const configured = {
  enabled: "true",
  token: "secret",
  url: "https://diagnostics.example.com",
};

test("only an explicit true enables the deployment switch", () => {
  assert.equal(parseDiagnosticsEnabled("true"), true);
  assert.equal(parseDiagnosticsEnabled("1"), true);
  assert.equal(parseDiagnosticsEnabled(" TRUE "), true);
  assert.equal(parseDiagnosticsEnabled(undefined), false);
  assert.equal(parseDiagnosticsEnabled(""), false);
  assert.equal(parseDiagnosticsEnabled("false"), false);
  assert.equal(parseDiagnosticsEnabled("yes"), false);
});

test("a registration is sent only when every gate is open", () => {
  const granted = { ...configured, consent: "granted" as const, consentVersion: DIAGNOSTICS_CONSENT_VERSION };
  assert.equal(diagnosticsGate(granted), true);

  assert.equal(diagnosticsGate({ ...granted, enabled: "false" }), false);
  assert.equal(diagnosticsGate({ ...granted, enabled: undefined }), false);
  assert.equal(diagnosticsGate({ ...granted, token: "  " }), false);
  assert.equal(diagnosticsGate({ ...granted, token: undefined }), false);
  assert.equal(diagnosticsGate({ ...granted, url: "" }), false);
  assert.equal(diagnosticsGate({ ...granted, consent: "undecided" }), false);
  assert.equal(diagnosticsGate({ ...granted, consent: "denied" }), false);
  assert.equal(diagnosticsGate({ ...granted, consentVersion: 0 }), false);
  assert.equal(diagnosticsGate({ ...granted, consentVersion: DIAGNOSTICS_CONSENT_VERSION - 1 }), false);
});

test("credentials without the switch stay unconfigured from the owner's point of view", () => {
  assert.equal(diagnosticsConfigured(configured), true);
  assert.equal(diagnosticsUnavailableReason({ ...configured, enabled: "false" }), "disabled");
  assert.equal(diagnosticsUnavailableReason({ ...configured, token: undefined }), "unconfigured");
  assert.equal(diagnosticsUnavailableReason({ enabled: undefined, token: undefined, url: undefined }), "disabled");
});

test("the payload is the allowlist and omits the password and the owner's name", () => {
  const payload = buildDiagnosticsPayload({
    event: "instance_registered",
    instanceId: "6b0e2d3a-1c4f-4a7b-9d2e-0f1a2b3c4d5e",
    occurredAt: "2026-10-28T00:00:00.000Z",
    appVersion: "0.2.2",
    email: "owner@example.com",
    cfAccountId: "abc",
    workerName: "dotnote",
    workerUrl: "https://dotnote.example.workers.dev",
  });
  assert.deepEqual([...DIAGNOSTICS_PAYLOAD_KEYS].sort(), Object.keys(payload).sort());
  assert.equal("password" in payload, false);
  assert.equal("fullName" in payload, false);
  assert.equal("notes" in payload, false);
});

test("an unchanged registration has a stable fingerprint", () => {
  const base = {
    instanceId: "6b0e2d3a-1c4f-4a7b-9d2e-0f1a2b3c4d5e",
    appVersion: "0.2.2",
    email: "owner@example.com",
    cfAccountId: "abc",
    workerName: "dotnote",
    workerUrl: "https://dotnote.example.workers.dev",
  };
  const first = buildDiagnosticsPayload({ ...base, event: "instance_registered", occurredAt: "2026-10-28T00:00:00.000Z" });
  const again = buildDiagnosticsPayload({ ...base, event: "instance_updated", occurredAt: "2026-10-28T01:00:00.000Z" });
  assert.equal(diagnosticsFingerprint(first), diagnosticsFingerprint(again));
  const moved = buildDiagnosticsPayload({
    ...base,
    event: "instance_updated",
    occurredAt: "2026-10-28T01:00:00.000Z",
    workerUrl: "https://notes.example.com",
  });
  assert.notEqual(diagnosticsFingerprint(first), diagnosticsFingerprint(moved));
});

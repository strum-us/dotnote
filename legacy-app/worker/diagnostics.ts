import {
  buildDiagnosticsPayload,
  diagnosticsConfigured,
  diagnosticsEndpointHost,
  diagnosticsFingerprint,
  diagnosticsGate,
  diagnosticsUnavailableReason,
  type DiagnosticsPayload,
  type DiagnosticsPreview,
  type DiagnosticsStatus,
} from "@shared/diagnostics";
import {
  clearDiagnosticsRegistration,
  denyDiagnosticsConsent,
  grantDiagnosticsConsent,
  markDiagnosticsReported,
  readDiagnostics,
  type StoredDiagnostics,
} from "./accounts";
import type { Env } from "./env";
import { BUILD_VERSION } from "./update/version";

export const DIAGNOSTICS_REPORT_ERROR = "Dotnote Cloud did not accept this registration.";

function deployment(env: Env) {
  return {
    enabled: env.DOTNOTE_DIAGNOSTICS_ENABLED,
    token: env.DOTNOTE_DIAGNOSTICS_TOKEN,
    url: env.DOTNOTE_DIAGNOSTICS_URL,
  };
}

function previewFrom(row: StoredDiagnostics, env: Env, origin: string, now: string): DiagnosticsPreview {
  const event = row.lastReportedAt ? "instance_updated" : "instance_registered";
  const fields = {
    event,
    occurredAt: now,
    appVersion: BUILD_VERSION,
    email: row.email,
    cfAccountId: env.CF_ACCOUNT_ID?.trim() || null,
    workerName: env.WORKER_NAME?.trim() || null,
    workerUrl: origin,
  } as const;
  if (!row.instanceId) return { schemaVersion: 1, instanceId: null, ...fields };
  return buildDiagnosticsPayload({ instanceId: row.instanceId, ...fields });
}

export async function diagnosticsStatus(
  env: Env,
  userId: string,
  origin: string,
  reportError: string | null = null,
): Promise<DiagnosticsStatus | null> {
  const row = await readDiagnostics(env, userId);
  if (!row) return null;
  const gate = deployment(env);
  const reason = diagnosticsUnavailableReason(gate);
  return {
    available: reason === null,
    unavailableReason: reason,
    consent: row.consent,
    consentVersion: row.consentVersion,
    consentedAt: row.consentedAt,
    lastReportedAt: row.lastReportedAt,
    endpointHost: reason === "disabled" ? null : diagnosticsEndpointHost(env.DOTNOTE_DIAGNOSTICS_URL),
    payload: previewFrom(row, env, origin, new Date().toISOString()),
    reportError,
  };
}

/** Public setup hint. The host is not a secret; the token never leaves the worker. */
export function diagnosticsOffer(env: Env): { diagnosticsAvailable: boolean; diagnosticsHost: string | null } {
  const available = diagnosticsConfigured(deployment(env));
  return {
    diagnosticsAvailable: available,
    diagnosticsHost: available ? diagnosticsEndpointHost(env.DOTNOTE_DIAGNOSTICS_URL) : null,
  };
}

async function postDiagnostics(env: Env, payload: DiagnosticsPayload): Promise<void> {
  const token = env.DOTNOTE_DIAGNOSTICS_TOKEN?.trim() ?? "";
  const base = env.DOTNOTE_DIAGNOSTICS_URL?.trim().replace(/\/$/, "") ?? "";
  const path =
    payload.event === "instance_unregistered" ? "/api/diagnostics/v1/unregister" : "/api/diagnostics/v1/register";
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`diagnostics_${res.status}`);
}

/**
 * Send the current registration when consent and the deployment switch allow it.
 * An unchanged fingerprint does not hit the network. Failures throw; callers decide
 * whether account actions should wait on them.
 */
export async function reportDiagnostics(env: Env, userId: string, origin: string): Promise<void> {
  const row = await readDiagnostics(env, userId);
  if (!row?.instanceId) return;
  if (
    !diagnosticsGate({
      ...deployment(env),
      consent: row.consent,
      consentVersion: row.consentVersion,
    })
  ) {
    return;
  }
  const payload = buildDiagnosticsPayload({
    event: row.lastReportedAt ? "instance_updated" : "instance_registered",
    instanceId: row.instanceId,
    occurredAt: new Date().toISOString(),
    appVersion: BUILD_VERSION,
    email: row.email,
    cfAccountId: env.CF_ACCOUNT_ID?.trim() || null,
    workerName: env.WORKER_NAME?.trim() || null,
    workerUrl: origin,
  });
  const fingerprint = diagnosticsFingerprint(payload);
  if (fingerprint === row.reportedFingerprint) return;
  await postDiagnostics(env, payload);
  await markDiagnosticsReported(env, userId, fingerprint);
}

export async function grantAndReport(env: Env, userId: string, origin: string): Promise<void> {
  const granted = await grantDiagnosticsConsent(env, userId);
  if (!granted) return;
  await reportDiagnostics(env, userId, origin);
}

/**
 * Stop sending. A delete is attempted only after something was actually registered.
 * Sending stops even when the remote delete fails; the instance id is kept so a later try can finish it.
 */
export async function withdrawDiagnostics(env: Env, userId: string, origin: string, unregister: boolean): Promise<void> {
  const row = await readDiagnostics(env, userId);
  if (!row) return;
  const sent = Boolean(unregister && row.instanceId && row.lastReportedAt);
  if (!sent || !row.instanceId) {
    await denyDiagnosticsConsent(env, userId);
    return;
  }
  if (!diagnosticsConfigured(deployment(env))) {
    await denyDiagnosticsConsent(env, userId);
    throw new Error("diagnostics_unconfigured");
  }
  try {
    await postDiagnostics(
      env,
      buildDiagnosticsPayload({
        event: "instance_unregistered",
        instanceId: row.instanceId,
        occurredAt: new Date().toISOString(),
        appVersion: BUILD_VERSION,
        email: row.email,
        cfAccountId: env.CF_ACCOUNT_ID?.trim() || null,
        workerName: env.WORKER_NAME?.trim() || null,
        workerUrl: origin,
      }),
    );
  } catch (err) {
    await denyDiagnosticsConsent(env, userId);
    throw err;
  }
  await clearDiagnosticsRegistration(env, userId);
}

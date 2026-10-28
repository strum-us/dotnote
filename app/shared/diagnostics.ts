/** Bump when the registration payload gains a field. Older consent does not cover the new payload. */
export const DIAGNOSTICS_CONSENT_VERSION = 1;

export const DIAGNOSTICS_PAYLOAD_KEYS = [
  "schemaVersion",
  "event",
  "instanceId",
  "occurredAt",
  "appVersion",
  "email",
  "cfAccountId",
  "workerName",
  "workerUrl",
] as const;

export type DiagnosticsConsent = "granted" | "denied" | "undecided";

export type DiagnosticsEvent = "instance_registered" | "instance_updated" | "instance_unregistered";

/** Fields that may leave the deployment. Password, notes, and names are not in this type. */
export type DiagnosticsPayload = {
  schemaVersion: 1;
  event: DiagnosticsEvent;
  instanceId: string;
  occurredAt: string;
  appVersion: string;
  email: string;
  cfAccountId: string | null;
  workerName: string | null;
  workerUrl: string;
};

export type DiagnosticsPreview = Omit<DiagnosticsPayload, "instanceId"> & {
  instanceId: string | null;
};

export type DiagnosticsStatus = {
  /** Token, URL, and the deployment switch are all present. Consent is still required to send. */
  available: boolean;
  unavailableReason: "disabled" | "unconfigured" | null;
  consent: DiagnosticsConsent;
  consentVersion: number;
  consentedAt: string | null;
  lastReportedAt: string | null;
  endpointHost: string | null;
  payload: DiagnosticsPreview;
  reportError: string | null;
};

export function parseDiagnosticsEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

export function diagnosticsConfigured(input: {
  enabled: string | undefined;
  token: string | undefined;
  url: string | undefined;
}): boolean {
  if (!parseDiagnosticsEnabled(input.enabled)) return false;
  if (!input.token?.trim()) return false;
  if (!input.url?.trim()) return false;
  return true;
}

/**
 * Reporting happens only when the deployment allows it and the owner granted
 * the current consent version. Any missing piece skips the network call.
 */
export function diagnosticsGate(input: {
  enabled: string | undefined;
  token: string | undefined;
  url: string | undefined;
  consent: DiagnosticsConsent;
  consentVersion: number;
}): boolean {
  if (!diagnosticsConfigured(input)) return false;
  if (input.consent !== "granted") return false;
  if (input.consentVersion < DIAGNOSTICS_CONSENT_VERSION) return false;
  return true;
}

export function diagnosticsUnavailableReason(input: {
  enabled: string | undefined;
  token: string | undefined;
  url: string | undefined;
}): "disabled" | "unconfigured" | null {
  if (!parseDiagnosticsEnabled(input.enabled)) return "disabled";
  if (!input.token?.trim() || !input.url?.trim()) return "unconfigured";
  return null;
}

export function diagnosticsEndpointHost(url: string | undefined): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).host;
  } catch {
    return null;
  }
}

/** Identity of a registration. Time and event are left out so an unchanged instance is not sent again. */
export function diagnosticsFingerprint(payload: DiagnosticsPayload): string {
  return JSON.stringify({
    schemaVersion: payload.schemaVersion,
    instanceId: payload.instanceId,
    appVersion: payload.appVersion,
    email: payload.email,
    cfAccountId: payload.cfAccountId,
    workerName: payload.workerName,
    workerUrl: payload.workerUrl,
  });
}

export function buildDiagnosticsPayload(input: {
  event: DiagnosticsEvent;
  instanceId: string;
  occurredAt: string;
  appVersion: string;
  email: string;
  cfAccountId: string | null;
  workerName: string | null;
  workerUrl: string;
}): DiagnosticsPayload {
  return { schemaVersion: 1, ...input };
}

export function asDiagnosticsConsent(value: string | null | undefined): DiagnosticsConsent {
  if (value === "granted" || value === "denied" || value === "undecided") return value;
  return "undecided";
}

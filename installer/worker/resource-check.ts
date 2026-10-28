import {
  findD1,
  findR2,
  findWorkersDomainService,
  hostnameConflict,
  scriptExists,
  scriptSettings,
  type ScriptBinding,
} from "./cf-api";

export type ResourceKind = "free" | "dotnote" | "foreign" | "unknown" | "invalid";

export type InstallMode = "fresh" | "update" | "repair" | "wipe";

export type CheckResponse = {
  worker: ResourceKind;
  database: ResourceKind;
  bucket: ResourceKind;
  hostname: { ok: boolean; detail?: string } | null;
  suggestedMode: InstallMode | "blocked";
  blockReason: string | null;
  installedVersion: string | null;
  d1Id: string | null;
};

function bindingText(bindings: ScriptBinding[], name: string): string | null {
  const hit = bindings.find((row) => row.name === name && row.type === "plain_text");
  return typeof hit?.text === "string" ? hit.text : null;
}

function bindingD1Id(bindings: ScriptBinding[]): string | null {
  const hit = bindings.find((row) => row.name === "DB" && row.type === "d1");
  const id = hit?.id;
  return typeof id === "string" ? id : null;
}

function bindingBucket(bindings: ScriptBinding[]): string | null {
  const hit = bindings.find((row) => row.name === "BUCKET" && row.type === "r2_bucket");
  const name = hit?.bucket_name;
  return typeof name === "string" ? name : null;
}

function workerLooksLikeDotnote(
  bindings: ScriptBinding[],
  workerName: string,
  expectedD1Id: string | null,
  expectedBucket: string,
): boolean {
  const named = bindingText(bindings, "WORKER_NAME");
  const bucket = bindingBucket(bindings);
  const d1Id = bindingD1Id(bindings);
  const installer = bindingText(bindings, "INSTALLER_ORIGIN");
  if (named && named !== workerName) return false;
  if (bucket && bucket !== expectedBucket) return false;
  if (expectedD1Id && d1Id && d1Id !== expectedD1Id) return false;
  if (!installer && !bindingText(bindings, "CF_OAUTH_CLIENT_ID")) return false;
  return true;
}

function classifyTaken(kind: "dotnote" | "foreign" | "unknown"): ResourceKind {
  return kind;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da > db ? 1 : -1;
  }
  return 0;
}

export async function classifyResources(
  token: string,
  accountId: string,
  workerName: string,
  hostname: string,
  zoneId: string,
  zoneName: string,
): Promise<CheckResponse> {
  const dbLabel = `${workerName}-index`;
  const bucketLabel = `${workerName}-data`;

  const [workerPresent, d1Id, bucketPresent] = await Promise.all([
    scriptExists(token, accountId, workerName),
    findD1(token, accountId, dbLabel),
    findR2(token, accountId, bucketLabel),
  ]);

  let bindings: ScriptBinding[] = [];
  let installedVersion: string | null = null;
  let workerKind: ResourceKind = workerPresent ? "unknown" : "free";

  if (workerPresent) {
    try {
      const settings = await scriptSettings(token, accountId, workerName);
      bindings = settings.bindings ?? [];
      installedVersion = bindingText(bindings, "APP_VERSION");
      workerKind = workerLooksLikeDotnote(bindings, workerName, d1Id, bucketLabel)
        ? "dotnote"
        : classifyTaken("foreign");
    } catch {
      workerKind = "unknown";
    }
  }

  let databaseKind: ResourceKind = d1Id ? "unknown" : "free";
  if (d1Id) {
    if (workerKind === "dotnote") {
      const bound = bindingD1Id(bindings);
      databaseKind = !bound || bound === d1Id ? "dotnote" : "foreign";
    } else if (workerKind === "free") {
      databaseKind = "dotnote";
    } else {
      databaseKind = workerKind === "foreign" ? "foreign" : "unknown";
    }
  }

  let bucketKind: ResourceKind = bucketPresent ? "unknown" : "free";
  if (bucketPresent) {
    if (workerKind === "dotnote") {
      const bound = bindingBucket(bindings);
      bucketKind = !bound || bound === bucketLabel ? "dotnote" : "foreign";
    } else if (workerKind === "free") {
      bucketKind = "dotnote";
    } else {
      bucketKind = workerKind === "foreign" ? "foreign" : "unknown";
    }
  }

  let host: CheckResponse["hostname"] = null;
  if (hostname) {
    if (!zoneId || !zoneName || hostname === zoneName || !hostname.endsWith(`.${zoneName}`)) {
      host = { ok: false, detail: "Choose a name on a domain this account already has." };
    } else {
      const service = await findWorkersDomainService(token, accountId, hostname);
      if (service && service !== workerName) {
        host = { ok: false, detail: "That name is already used by another Worker." };
      } else if (service === workerName) {
        host = { ok: true };
      } else {
        const detail = await hostnameConflict(token, zoneId, zoneName, hostname);
        host = detail ? { ok: false, detail } : { ok: true };
      }
    }
  }

  const kinds = [workerKind, databaseKind, bucketKind];
  if (kinds.includes("foreign")) {
    return {
      worker: workerKind,
      database: databaseKind,
      bucket: bucketKind,
      hostname: host,
      suggestedMode: "blocked",
      blockReason: "That name is already used by something that is not Dotnote.",
      installedVersion,
      d1Id,
    };
  }
  if (kinds.includes("unknown")) {
    return {
      worker: workerKind,
      database: databaseKind,
      bucket: bucketKind,
      hostname: host,
      suggestedMode: "blocked",
      blockReason: "Cloudflare could not confirm whether those resources belong to Dotnote.",
      installedVersion,
      d1Id,
    };
  }

  const anyTaken = workerKind !== "free" || databaseKind !== "free" || bucketKind !== "free";
  if (!anyTaken) {
    return {
      worker: workerKind,
      database: databaseKind,
      bucket: bucketKind,
      hostname: host,
      suggestedMode: "fresh",
      blockReason: null,
      installedVersion,
      d1Id,
    };
  }

  let suggestedMode: InstallMode | "blocked" = "repair";
  if (workerKind === "dotnote" && databaseKind === "dotnote" && bucketKind === "dotnote") {
    suggestedMode = "update";
  } else if (workerKind === "dotnote" || databaseKind === "dotnote" || bucketKind === "dotnote") {
    suggestedMode = "repair";
  } else {
    suggestedMode = "blocked";
  }

  let blockReason: string | null = null;
  if (suggestedMode === "blocked") {
    blockReason = "Some Dotnote resources are missing. Choose another name or remove the leftovers in Cloudflare.";
  } else if (host && !host.ok) {
    blockReason = host.detail ?? "That address cannot be used.";
    suggestedMode = "blocked";
  }

  return {
    worker: workerKind,
    database: databaseKind,
    bucket: bucketKind,
    hostname: host,
    suggestedMode: blockReason ? "blocked" : suggestedMode,
    blockReason,
    installedVersion,
    d1Id,
  };
}

export async function assertInstallMode(
  token: string,
  accountId: string,
  workerName: string,
  hostname: string,
  zoneId: string,
  zoneName: string,
  mode: InstallMode,
): Promise<CheckResponse> {
  const check = await classifyResources(token, accountId, workerName, hostname, zoneId, zoneName);
  if (mode === "wipe") {
    if (check.suggestedMode === "blocked" && check.blockReason?.includes("not Dotnote")) {
      throw new Error(check.blockReason);
    }
    return check;
  }
  if (mode === "fresh" && check.suggestedMode !== "fresh") {
    throw new Error("Those names are not free. Update or repair the existing Dotnote instead.");
  }
  if (mode === "update" && check.suggestedMode !== "update") {
    throw new Error("This account does not have a complete Dotnote install to update.");
  }
  if (mode === "repair" && check.suggestedMode !== "repair" && check.suggestedMode !== "update") {
    throw new Error("Nothing here looks like a Dotnote install that can be repaired.");
  }
  if (check.suggestedMode === "blocked" || (check.hostname && !check.hostname.ok)) {
    throw new Error(check.blockReason ?? check.hostname?.detail ?? "That install cannot continue.");
  }
  return check;
}

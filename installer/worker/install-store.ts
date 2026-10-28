import type { Env } from "./env";
import type { InstallMode } from "./resource-check";

export type InstallState = {
  d1Id?: string;
  r2Name?: string;
  domainId?: string;
  scriptUploaded?: boolean;
  d1Created?: boolean;
  r2Created?: boolean;
  domainCreated?: boolean;
  d1Adopted?: boolean;
  r2Adopted?: boolean;
  workerAdopted?: boolean;
  installedVersion?: string;
  migrationIndex?: number;
  assetBucket?: number;
  assetBuckets?: string[][];
  uploadJwt?: string;
  completionJwt?: string;
  subdomain?: string;
};

export type Installation = {
  id: string;
  keyHash: string;
  accountId: string;
  accountName: string;
  workerName: string;
  hostname: string | null;
  zoneId: string | null;
  zoneName: string | null;
  address: string;
  handoffHash: string;
  releaseVersion: string;
  mode: InstallMode;
  stepIndex: number;
  status: string;
  message: string | null;
  state: InstallState;
  createdAt: string;
  updatedAt: string;
};

type Row = {
  id: string;
  keyHash: string;
  accountId: string;
  accountName: string;
  workerName: string;
  hostname: string | null;
  zoneId: string | null;
  zoneName: string | null;
  address: string;
  handoffHash: string;
  releaseVersion: string;
  mode: string;
  stepIndex: number;
  status: string;
  message: string | null;
  stateJson: string;
  createdAt: string;
  updatedAt: string;
};

const SELECT = `SELECT id, key_hash as keyHash, account_id as accountId, account_name as accountName,
  worker_name as workerName, hostname, zone_id as zoneId, zone_name as zoneName, address,
  handoff_hash as handoffHash, release_version as releaseVersion, mode, step_index as stepIndex,
  status, message, state_json as stateJson, created_at as createdAt, updated_at as updatedAt
  FROM installations`;

function mapRow(row: Row): Installation {
  let state: InstallState = {};
  try {
    state = JSON.parse(row.stateJson) as InstallState;
  } catch {
    state = {};
  }
  return { ...row, mode: (row.mode as InstallMode) || "fresh", state };
}

export async function insertInstallation(env: Env, row: Installation): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO installations (
      id, key_hash, account_id, account_name, worker_name, hostname, zone_id, zone_name, address,
      handoff_hash, release_version, mode, step_index, status, message, state_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      row.id,
      row.keyHash,
      row.accountId,
      row.accountName,
      row.workerName,
      row.hostname,
      row.zoneId,
      row.zoneName,
      row.address,
      row.handoffHash,
      row.releaseVersion,
      row.mode,
      row.stepIndex,
      row.status,
      row.message,
      JSON.stringify(row.state),
      row.createdAt,
      row.updatedAt,
    )
    .run();
}

export async function saveInstallation(env: Env, row: Installation): Promise<void> {
  row.updatedAt = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE installations SET step_index = ?, status = ?, message = ?, state_json = ?, release_version = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(row.stepIndex, row.status, row.message, JSON.stringify(row.state), row.releaseVersion, row.updatedAt, row.id)
    .run();
}

/** Hand the installation to another browser: a new browser key and a new setup code. */
export async function rekeyInstallation(env: Env, row: Installation): Promise<void> {
  row.updatedAt = new Date().toISOString();
  await env.DB.prepare("UPDATE installations SET key_hash = ?, handoff_hash = ?, updated_at = ? WHERE id = ?")
    .bind(row.keyHash, row.handoffHash, row.updatedAt, row.id)
    .run();
}

export async function getInstallation(env: Env, id: string): Promise<Installation | null> {
  const row = await env.DB.prepare(`${SELECT} WHERE id = ?`).bind(id).first<Row>();
  return row ? mapRow(row) : null;
}

export async function listInstallations(env: Env, accountId: string): Promise<Installation[]> {
  const { results } = await env.DB.prepare(`${SELECT} WHERE account_id = ? ORDER BY created_at DESC`)
    .bind(accountId)
    .all<Row>();
  return (results ?? []).map(mapRow);
}

export async function deleteInstallation(env: Env, id: string): Promise<void> {
  await env.DB.prepare("DELETE FROM installations WHERE id = ?").bind(id).run();
}

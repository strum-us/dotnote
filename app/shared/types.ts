export type User = {
  id: string;
  fullName: string;
  email: string;
  /** When true, mutations are kept local only; the server rejects writes. */
  syncDisabled: boolean;
};

export type AuthSetup = {
  needsAccount: boolean;
  installerOrigin: string | null;
  /** True when this deployment can register with Dotnote Cloud. Consent is still required. */
  diagnosticsAvailable: boolean;
  diagnosticsHost: string | null;
};

export type Workspace = {
  id: string;
  name: string;
  createdAt: string;
};

export type TreeNode = {
  id: string;
  type: "folder" | "note";
  name: string;
  path: string;
  parentPath: string;
  children?: TreeNode[];
  createdAt?: string;
  updatedAt?: string;
};

export type ManifestEntry = {
  id: string;
  type: "folder" | "note";
  name: string;
  path: string;
  parentPath: string;
  contentHash?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type WorkspaceManifest = {
  version: 1;
  rev: number;
  entries: ManifestEntry[];
};

export type NoteMeta = {
  id: string;
  path: string;
  title: string;
  contentHash: string;
  updatedAt: string;
};

export type BackupSummary = {
  backupId: string;
  createdAt: string;
  trigger: "manual" | "auto";
};

export type StoredBackup = BackupSummary & {
  content: string;
};

export type CloudflareBindingStatus = {
  ok: boolean;
  latencyMs: number;
  error?: string | null;
};

export type CloudflareStatusResponse = {
  checkedAt: string;
  accountId: string | null;
  worker: CloudflareBindingStatus & {
    name: string;
    url: string;
    environment: string;
  };
  r2: CloudflareBindingStatus & {
    bucketName: string;
    binding: string;
  };
  d1: CloudflareBindingStatus & {
    databaseName: string;
    binding: string;
  };
  connection: {
    connected: boolean;
    accountId: string | null;
    scopes: string[];
    updatedAt: string | null;
  };
  installerOrigin: string | null;
  links: {
    workerDashboard: string;
    r2BucketDashboard: string;
    createBucket: string;
    r2ApiTokens: string;
  };
};

export type R2UsageCategory = "notes" | "history" | "assets" | "manifests" | "other";

export type R2UsageResponse = {
  computedAt: string;
  totalBytes: number;
  objectCount: number;
  byCategory: Record<R2UsageCategory, number>;
  byWorkspace: {
    workspaceId: string;
    name: string;
    bytes: number;
    objects: number;
    byCategory: Record<R2UsageCategory, number>;
  }[];
  freeTierBytes: number;
};

export type R2MigrationCursor = {
  workspaceIndex: number;
  listCursor?: string;
};

export type R2CopyBatchResponse = {
  done: boolean;
  copied: number;
  bytesCopied: number;
  cursor: R2MigrationCursor | null;
  errors: { key: string; message: string }[];
  workspaceCount: number;
};

export type NoteShareStatus = {
  active: boolean;
  token?: string;
  url?: string;
  createdAt?: string;
};

/** Why this instance cannot update itself. Only `missing_scopes` is worth showing outside settings. */
export type UpdateBlockedReason =
  | "development"
  | "no_installer"
  | "unconfigured"
  | "not_connected"
  | "missing_scopes";

export type UpdateStepId = "prepare" | "migrate" | "assets" | "upload" | "deploy" | "verify";

export type UpdateJobView = {
  id: string;
  kind: "update" | "rollback";
  fromVersion: string;
  toVersion: string;
  status: "running" | "failed" | "done" | "cancelled";
  step: { id: UpdateStepId; label: string; index: number; total: number };
  /** Progress while running, the error once failed. */
  message: string | null;
  /** `permission`: reconnect Cloudflare. `unverified`: deployed, but the new version has not answered yet. */
  errorCode: "permission" | "unverified" | "error" | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  /** Set while running: call the step endpoint again after this long. */
  retryAfterMs?: number;
};

export type UpdateCheckResponse = {
  checkedAt: string;
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releasedAt: string | null;
  notes: string | null;
  sizeBytes: number | null;
  canUpdate: boolean;
  blockedReason: UpdateBlockedReason | null;
  /** A newer release exists but this instance is outside its staged rollout. */
  rolloutHeld: boolean;
  /** The version this one updated itself from. Rolling back needs that release to still be archived. */
  rollbackVersion: string | null;
  /** The installer could not be reached or sent no usable release. */
  error: string | null;
  job: UpdateJobView | null;
  /** What this instance replaces itself with: the installer's grant. Missing before 0.2.4. */
  credential?: "grant" | null;
  /** The owner turned on automatic updates (a Cron Trigger every 30 minutes). Missing before 0.2.4. */
  autoUpdate?: boolean;
};

export type UpdateStatusResponse = {
  currentVersion: string;
  job: UpdateJobView | null;
};

export type PublicSharePayload = {
  title: string;
  markdown: string;
  notePath: string;
  updatedAt: string;
};

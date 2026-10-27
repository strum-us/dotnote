export type User = {
  id: string;
  fullName: string;
  email: string;
};

export type AuthSetup = {
  needsAccount: boolean;
  installerOrigin: string | null;
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

export type PublicSharePayload = {
  title: string;
  markdown: string;
  notePath: string;
  updatedAt: string;
};

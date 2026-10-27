import { makeAutoObservable, runInAction } from "mobx";
import { folderPathById, uniquePath } from "@shared/manifest";
import { MAX_PAGE_ASSET_BYTES } from "@shared/page-assets";
import { assetApi } from "@/lib/api";
import { emitFileWrite } from "@/lib/file-write-events";
import {
  deleteImportHandle,
  deleteImportJob,
  readImportHandle,
  readImportJob,
  writeImportHandle,
  writeImportJob,
  type ImportJob,
} from "@/lib/import-db";
import {
  applyImportedAssets,
  buildFolderPlan,
  collectNoteAssets,
  ensureImportTitle,
  isMarkdownPath,
  parentFolderId,
  type PlannedAsset,
  type PlannedNote,
  type SourceMeta,
} from "@/lib/import-markdown";
import { deleteImportFiles, importAssetExists, readImportBlob, readImportText, writeImportBlob, writeImportText } from "@/lib/import-opfs";
import { listHandleFiles, listInputFiles, type PickedFile } from "@/lib/import-source";
import { findTreeNode } from "@/lib/tree-utils";
import { syncStore } from "@/stores/sync-store";
import { workspaceStore } from "@/stores/workspace-store";

function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function snapshot(job: ImportJob): ImportJob {
  return {
    ...job,
    errors: job.errors.map((error) => ({ ...error })),
    publishedNoteIds: [...job.publishedNoteIds],
    publishedAssetKeys: [...job.publishedAssetKeys],
    plan: job.plan
      ? {
          folders: job.plan.folders.map((folder) => ({ ...folder })),
          notes: job.plan.notes.map((note) => ({
            ...note,
            assets: note.assets.map((asset) => ({ ...asset })),
          })),
        }
      : null,
  };
}

async function withImportLock(ownerId: string, body: () => Promise<void>): Promise<void> {
  if (!navigator.locks) {
    await body();
    return;
  }
  await navigator.locks.request(`dotnote-import:${ownerId}`, body);
}

class ImportStore {
  job: ImportJob | null = null;
  running = false;

  private bootedFor: string | null = null;
  private holdingLock = false;
  private persistChain: Promise<void> = Promise.resolve();

  constructor() {
    makeAutoObservable<ImportStore, "bootedFor" | "holdingLock" | "persistChain">(
      this,
      { bootedFor: false, holdingLock: false, persistChain: false },
      { autoBind: true },
    );
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", (event) => {
        if (!this.running || !this.job) return;
        if (this.job.phase === "done" || this.job.phase === "failed") return;
        event.preventDefault();
        event.returnValue = "";
      });
    }
  }

  get busy(): boolean {
    const phase = this.job?.phase;
    return phase === "staging" || phase === "publishing" || phase === "needs-permission";
  }

  get notesTotal(): number {
    return this.job?.plan?.notes.length ?? this.job?.notesTotal ?? 0;
  }

  get notesDone(): number {
    if (!this.job) return 0;
    if (this.job.phase === "staging" || this.job.phase === "needs-permission") return this.job.notesStaged;
    return this.job.publishedNoteIds.length;
  }

  get assetsTotal(): number {
    return this.job?.plan?.notes.reduce((sum, note) => sum + note.assets.length, 0) ?? 0;
  }

  get assetsDone(): number {
    return this.job?.publishedAssetKeys.length ?? 0;
  }

  async boot(userId: string): Promise<void> {
    if (this.bootedFor === userId) return;
    this.bootedFor = userId;
    const job = await readImportJob(userId);
    runInAction(() => {
      this.job = job;
    });
    if (!job || job.phase === "done" || job.phase === "failed") return;
    if (job.plan) {
      void this.run(() => this.publish());
      return;
    }
    const handle = await readImportHandle(userId).catch(() => null);
    if (!handle) {
      await this.update({
        phase: "failed",
        message: "Import was interrupted before the folder finished copying.",
      });
      return;
    }
    const permission = await handle.queryPermission({ mode: "read" }).catch(() => "prompt" as PermissionState);
    if (permission === "granted") {
      void this.run(() => this.stageAndPublish(handle));
      return;
    }
    await this.update({ phase: "needs-permission" });
  }

  /** Start a one-time copy from a directory the user just picked. Returns the new workspace id. */
  startDirectory(name: string, root: FileSystemDirectoryHandle): string | null {
    const ownerId = syncStore.userId;
    if (!ownerId || !syncStore.ready || this.busy || this.holdingLock) return null;
    const workspaceName = name.trim().slice(0, 80);
    if (!workspaceName) return null;
    const workspaceId = this.openJob(ownerId, workspaceName, root.name);
    void writeImportHandle(ownerId, root).catch(() => {});
    void navigator.storage?.persist?.();
    void this.run(() => this.stageAndPublish(root));
    return workspaceId;
  }

  /** Safari fallback: the files from one `<input webkitdirectory>` choice. */
  startFileList(name: string, list: FileList): string | null {
    const ownerId = syncStore.userId;
    if (!ownerId || !syncStore.ready || this.busy || this.holdingLock) return null;
    const workspaceName = name.trim().slice(0, 80);
    if (!workspaceName) return null;
    const files = listInputFiles(list);
    const rootName = list[0]?.webkitRelativePath.split("/")[0] || workspaceName;
    const workspaceId = this.openJob(ownerId, workspaceName, rootName);
    void navigator.storage?.persist?.();
    void this.run(async () => {
      await this.stageFromFiles(files);
      await this.publish();
    });
    return workspaceId;
  }

  /** User gesture after a reload, so the browser can show the folder prompt again. */
  async grantAndContinue(): Promise<void> {
    const job = this.job;
    const ownerId = job?.ownerId;
    if (!job || !ownerId || job.phase !== "needs-permission" || this.holdingLock) return;
    const handle = await readImportHandle(ownerId).catch(() => null);
    if (!handle) {
      await this.update({ phase: "failed", message: "The folder permission is no longer available." });
      return;
    }
    const permission = await handle.requestPermission({ mode: "read" });
    if (permission !== "granted") return;
    void this.run(() => this.stageAndPublish(handle));
  }

  retry(): void {
    if (!this.job?.plan || this.job.phase !== "failed" || this.holdingLock) return;
    void this.update({ phase: "publishing", message: null }).then(() => {
      void this.run(() => this.publish());
    });
  }

  async dismiss(): Promise<void> {
    if (this.holdingLock) return;
    const job = this.job;
    if (!job) return;
    if (job.phase !== "done" && job.phase !== "failed" && job.phase !== "needs-permission") return;
    runInAction(() => {
      this.job = null;
    });
    await deleteImportJob(job.ownerId);
    await deleteImportHandle(job.ownerId);
    await deleteImportFiles(job.id).catch(() => {});
  }

  private openJob(ownerId: string, workspaceName: string, rootName: string): string {
    const previous = this.job;
    if (previous) void deleteImportFiles(previous.id).catch(() => {});
    const workspaceId = workspaceStore.createWorkspace(workspaceName, { seedNote: false });
    const now = Date.now();
    const job: ImportJob = {
      id: crypto.randomUUID(),
      ownerId,
      workspaceId,
      workspaceName,
      rootName,
      phase: "staging",
      plan: null,
      notesStaged: 0,
      notesTotal: 0,
      bytesStaged: 0,
      publishedNoteIds: [],
      publishedAssetKeys: [],
      currentPath: "",
      errors: [],
      message: null,
      startedAt: now,
      updatedAt: now,
    };
    runInAction(() => {
      this.job = job;
    });
    void this.persistJob();
    return workspaceId;
  }

  private async stageAndPublish(root: FileSystemDirectoryHandle): Promise<void> {
    await this.stageFromFiles(await this.readHandle(root));
    await this.publish();
  }

  private async readHandle(root: FileSystemDirectoryHandle): Promise<PickedFile[]> {
    await this.update({ phase: "staging", plan: null, currentPath: "", message: null });
    let seen = 0;
    return listHandleFiles(root, (path) => {
      seen += 1;
      if (seen % 20 !== 0) return;
      runInAction(() => {
        if (this.job) this.job.currentPath = path;
      });
    });
  }

  private async stageFromFiles(files: PickedFile[]): Promise<void> {
    const job = this.job;
    if (!job) return;
    if (!navigator.storage?.getDirectory) throw new Error("This browser cannot keep the import across a reload.");
    await deleteImportFiles(job.id);
    const markdown = files.filter((file) => isMarkdownPath(file.path)).sort((a, b) => a.path.localeCompare(b.path));
    const meta = new Map<string, SourceMeta>(files.map((file) => [file.path, { size: file.size, mimeType: file.mimeType }]));
    const byPath = new Map(files.map((file) => [file.path, file]));
    const folders = buildFolderPlan(markdown.map((file) => file.path));
    const notes: PlannedNote[] = [];
    await this.update({
      phase: "staging",
      plan: null,
      notesTotal: markdown.length,
      notesStaged: 0,
      bytesStaged: 0,
      errors: [],
      currentPath: "",
    });

    for (const file of markdown) {
      await this.update({ currentPath: file.path });
      const noteId = crypto.randomUUID();
      const text = await (await file.read()).text();
      const collected = collectNoteAssets(text, file.path, meta);
      for (const error of collected.errors) this.addError(error.path, error.message);
      const assets: PlannedAsset[] = [];
      for (const asset of collected.assets) {
        const source = byPath.get(asset.sourcePath);
        if (!source) continue;
        if (await importAssetExists(job.id, asset.sourcePath)) {
          assets.push(asset);
          continue;
        }
        const blob = await source.read();
        if (blob.size > MAX_PAGE_ASSET_BYTES) {
          this.addError(asset.sourcePath, "File is larger than 512 MB");
          continue;
        }
        if (blob.type) asset.mimeType = blob.type;
        await writeImportBlob(job.id, asset.sourcePath, blob);
        assets.push(asset);
        await this.update({ bytesStaged: (this.job?.bytesStaged ?? 0) + blob.size });
      }
      await writeImportText(job.id, file.path, text);
      notes.push({
        id: noteId,
        sourcePath: file.path,
        parentFolderId: parentFolderId(folders, file.path),
        assets,
      });
      await this.update({ notesStaged: notes.length });
      await yieldToMain();
    }

    await this.update({
      phase: "publishing",
      plan: { folders, notes },
      currentPath: "",
    });
  }

  private async publish(): Promise<void> {
    const job = this.job;
    if (!job?.plan || job.phase === "done") return;
    await this.update({ phase: "publishing", message: null });
    await this.waitForWorkspace(job.workspaceId);
    this.enqueueFolders();
    for (const note of job.plan.notes) {
      await this.publishNote(note);
      await yieldToMain();
    }
    const finished = this.job;
    if (!finished) return;
    await deleteImportFiles(finished.id).catch(() => {});
    await deleteImportHandle(finished.ownerId).catch(() => {});
    await this.update({ phase: "done", currentPath: "", message: null });
  }

  private enqueueFolders(): void {
    const job = this.job;
    if (!job?.plan) return;
    const workspaceId = job.workspaceId;
    const known = new Set(syncStore.view(workspaceId).entries.map((entry) => entry.id));
    for (const op of syncStore.ownOps) {
      if (op.workspaceId === workspaceId && op.kind === "createFolder") known.add(op.folderId);
    }
    for (const folder of job.plan.folders) {
      if (known.has(folder.id)) continue;
      syncStore.enqueue(workspaceId, {
        kind: "createFolder",
        folderId: folder.id,
        parentId: folder.parentId,
        name: folder.name,
      });
      known.add(folder.id);
    }
    if (workspaceStore.activeId === workspaceId) {
      for (const folder of job.plan.folders) {
        const node = findTreeNode(workspaceStore.viewTree, folder.id);
        if (node) workspaceStore.ensureExpanded(node.path);
      }
    }
  }

  private notePath(note: PlannedNote): string {
    const job = this.job;
    if (!job) return `${note.id}.md`;
    const manifest = syncStore.view(job.workspaceId);
    const existing = manifest.entries.find((entry) => entry.id === note.id && entry.type === "note");
    if (existing) return existing.path;
    const parentPath = folderPathById(manifest.entries, note.parentFolderId);
    return uniquePath(manifest.entries, parentPath, note.id, ".md");
  }

  private async publishNote(note: PlannedNote): Promise<void> {
    const job = this.job;
    if (!job) return;
    const uploaded = new Set(job.publishedAssetKeys);
    const succeeded: PlannedAsset[] = [];
    const notePath = this.notePath(note);
    for (const asset of note.assets) {
      const key = `${note.id}:${asset.sourcePath}`;
      if (uploaded.has(key)) {
        succeeded.push(asset);
        continue;
      }
      await this.update({ currentPath: asset.sourcePath });
      try {
        const blob = await readImportBlob(job.id, asset.sourcePath);
        await assetApi.saveRaw(job.workspaceId, notePath, asset.filename, blob, asset.mimeType);
        succeeded.push(asset);
        await this.update({ publishedAssetKeys: [...(this.job?.publishedAssetKeys ?? []), key] });
      } catch (error) {
        this.addError(asset.sourcePath, error instanceof Error ? error.message : "Upload failed");
        await this.persistJob();
      }
    }

    if (job.publishedNoteIds.includes(note.id)) return;
    const contentReady =
      syncStore.latestContent(job.workspaceId, note.id) !== null ||
      syncStore.view(job.workspaceId).entries.some((entry) => entry.id === note.id);
    if (!contentReady) {
      const original = await readImportText(job.id, note.sourcePath);
      const content = ensureImportTitle(applyImportedAssets(original, note.sourcePath, note.id, succeeded), note.sourcePath);
      syncStore.enqueue(job.workspaceId, {
        kind: "createNote",
        noteId: note.id,
        parentId: note.parentFolderId,
        content,
      });
      const created = findTreeNode(workspaceStore.tree, note.id);
      if (created) emitFileWrite({ type: "save", root: "notes", path: created.path, content });
    }
    await this.update({
      publishedNoteIds: [...(this.job?.publishedNoteIds ?? []), note.id],
      currentPath: note.sourcePath,
    });
  }

  private workspaceReady(workspaceId: string): boolean {
    const pending = syncStore.ownOps.some((op) => op.kind === "createWorkspace" && op.workspaceId === workspaceId);
    if (pending) return false;
    return workspaceStore.workspaces.some((workspace) => workspace.id === workspaceId);
  }

  private async waitForWorkspace(workspaceId: string): Promise<void> {
    if (!syncStore.ownOps.some((op) => op.kind === "createWorkspace" && op.workspaceId === workspaceId)) {
      await workspaceStore.refreshWorkspaces();
    }
    if (this.workspaceReady(workspaceId)) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        stop();
        reject(new Error("The workspace was not created."));
      }, 90_000);
      const stop = syncStore.subscribe((event) => {
        if (event.type === "rejected" && event.op.kind === "createWorkspace" && event.op.workspaceId === workspaceId) {
          clearTimeout(timer);
          stop();
          reject(new Error("The server refused the new workspace."));
          return;
        }
        if (event.type === "workspaceCreated" && event.workspace.id === workspaceId) {
          clearTimeout(timer);
          stop();
          resolve();
        }
      });
      if (this.workspaceReady(workspaceId)) {
        clearTimeout(timer);
        stop();
        resolve();
      }
    });
  }

  private async run(task: () => Promise<void>): Promise<void> {
    const ownerId = this.job?.ownerId ?? syncStore.userId;
    if (!ownerId) return;
    runInAction(() => {
      this.running = true;
    });
    try {
      await withImportLock(ownerId, async () => {
        this.holdingLock = true;
        try {
          await task();
        } finally {
          this.holdingLock = false;
        }
      });
    } catch (error) {
      if (this.job && this.job.phase !== "done") {
        await this.update({
          phase: "failed",
          message: error instanceof Error ? error.message : "Import failed",
        });
      }
    } finally {
      runInAction(() => {
        this.running = false;
      });
    }
  }

  private addError(path: string, message: string): void {
    const job = this.job;
    if (!job) return;
    if (job.errors.some((error) => error.path === path && error.message === message)) return;
    runInAction(() => {
      job.errors = [...job.errors, { path, message }].slice(-80);
    });
  }

  private async update(patch: Partial<ImportJob>): Promise<void> {
    runInAction(() => {
      if (!this.job) return;
      Object.assign(this.job, patch);
      this.job.updatedAt = Date.now();
    });
    await this.persistJob();
  }

  private persistJob(): Promise<void> {
    const job = this.job;
    if (!job) return Promise.resolve();
    const copy = snapshot(job);
    this.persistChain = this.persistChain
      .then(async () => {
        if (this.job?.id !== copy.id) return;
        await writeImportJob(copy);
      })
      .catch(() => {});
    return this.persistChain;
  }
}

export const importStore = new ImportStore();

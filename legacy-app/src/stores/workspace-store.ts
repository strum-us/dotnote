import { makeAutoObservable, reaction, runInAction } from "mobx";
import type { TreeNode, Workspace, WorkspaceManifest } from "@shared/types";
import { buildTree, emptyManifest } from "@shared/manifest";
import { displayEntryName, duplicateTitle, EMPTY_NOTE, replaceMarkdownTitle } from "@shared/title";
import { noteApi, workspaceApi } from "@/lib/api";
import { toast } from "sonner";
import { emitFileWrite } from "@/lib/file-write-events";
import { rememberSearchTree } from "@/lib/search-nav";
import { deleteCache, readCache, writeCache } from "@/lib/idb-cache";
import {
  findTreeNode,
  folderPathsToReveal,
  mapNoteTitle,
  notePathsUnder,
  shareTree,
  subtreeIds,
} from "@/lib/tree-utils";
import { noteStore } from "@/stores/note-store";
import { noteTabsStore } from "@/stores/note-tabs-store";
import { manifestCacheKey, syncStore } from "@/stores/sync-store";
import { parseNotePath } from "@/lib/note-route";
import { uiPreferenceStore } from "@/stores/ui-preference-store";

const ACTIVE_WORKSPACE_KEY = "dotnote-active-workspace";
const REVALIDATE_MIN_MS = 5000;

let sharedTree: TreeNode[] = [];

class WorkspaceStore {
  serverWorkspaces: Workspace[] = [];
  activeId: string | null = null;
  /** True until the first workspace list + active tree snapshot are resolved for boot. */
  booting = false;
  expanded = new Set<string>();
  /** Title of the note being typed, applied on top of the derived tree every keystroke. */
  liveTitle: { noteId: string; title: string } | null = null;

  private userId: string | null = null;
  private lastRevalidate = 0;

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
    reaction(() => this.viewTree, (tree) => rememberSearchTree(tree), { fireImmediately: true });
    if (typeof window !== "undefined") {
      window.addEventListener("focus", () => this.revalidate());
    }
  }

  get workspaces(): Workspace[] {
    const known = new Set(this.serverWorkspaces.map((w) => w.id));
    return [...this.serverWorkspaces, ...syncStore.pendingWorkspaces.filter((w) => !known.has(w.id))];
  }

  get activeWorkspace(): Workspace | null {
    return this.workspaces.find((w) => w.id === this.activeId) ?? null;
  }

  /** The active workspace's snapshot is in memory, so the tree is authoritative. */
  get treeReady(): boolean {
    return !!this.activeId && syncStore.ready && syncStore.bases.has(this.activeId);
  }

  get treeLoading(): boolean {
    if (!this.activeId || !syncStore.ready || this.treeReady) return false;
    return syncStore.manifestLoadState(this.activeId) !== "error";
  }

  get treeLoadFailed(): boolean {
    return !!this.activeId && !this.treeReady && syncStore.manifestLoadState(this.activeId) === "error";
  }

  /** Server snapshot plus pending ops, rebuilt structurally and shared by reference. */
  get viewTree(): TreeNode[] {
    if (!this.activeId) return [];
    sharedTree = shareTree(sharedTree, buildTree(syncStore.view(this.activeId).entries));
    return sharedTree;
  }

  get tree(): TreeNode[] {
    const live = this.liveTitle;
    return live ? mapNoteTitle(this.viewTree, live.noteId, live.title) : this.viewTree;
  }

  private loadExpanded(): void {
    this.expanded = new Set(this.activeId ? uiPreferenceStore.getExpandedFolders(this.activeId) : []);
    if (!this.activeId || this.expanded.size > 0) return;
    try {
      const raw = localStorage.getItem(`dotnote-expanded:${this.activeId}`);
      if (raw) {
        this.expanded = new Set(JSON.parse(raw) as string[]);
        this.persistExpanded();
      }
    } catch {
      /* ignore */
    }
  }

  private persistExpanded(): void {
    if (!this.activeId) return;
    uiPreferenceStore.setExpandedFolders(this.activeId, [...this.expanded]);
  }

  revealNote(noteId: string): void {
    const node = findTreeNode(this.viewTree, noteId);
    if (!node || node.type !== "note") return;
    for (const path of folderPathsToReveal(node.path)) {
      this.ensureExpanded(path);
    }
  }

  ensureExpanded(path: string): void {
    if (!path || this.expanded.has(path)) return;
    this.expanded.add(path);
    this.persistExpanded();
  }

  toggleExpanded(path: string): void {
    if (this.expanded.has(path)) this.expanded.delete(path);
    else this.expanded.add(path);
    this.persistExpanded();
  }

  /** Paint from IndexedDB first, then revalidate workspaces and the tree in the background. */
  async boot(userId: string, syncDisabled = false): Promise<void> {
    runInAction(() => {
      this.booting = true;
    });
    if (this.userId !== userId) {
      this.serverWorkspaces = [];
      this.activeId = null;
      this.liveTitle = null;
    }
    this.userId = userId;
    const [cachedWorkspaces] = await Promise.all([
      readCache<Workspace[]>(`workspaces:${userId}`, "trees").catch(() => null),
      syncStore.start(userId, { syncDisabled }),
    ]);

    const candidateId = this.resolveInitialWorkspaceId(cachedWorkspaces);
    const cachedManifest =
      candidateId && !syncStore.bases.has(candidateId)
        ? await readCache<WorkspaceManifest>(manifestCacheKey(candidateId), "trees").catch(() => null)
        : null;

    runInAction(() => {
      if (cachedWorkspaces && this.serverWorkspaces.length === 0) this.serverWorkspaces = cachedWorkspaces;
      if (candidateId && cachedManifest) syncStore.setBase(candidateId, cachedManifest);
      this.pickActive();
    });

    const activeId = this.activeId;
    if (activeId && !syncStore.bases.has(activeId)) {
      await syncStore.loadBase(activeId);
    }
    if (activeId && !this.treeReady) {
      await syncStore.refreshBase(activeId);
    }

    if (this.activeId) this.finishBootPhase();

    void this.refreshWorkspaces().then(() => {
      runInAction(() => {
        if (!this.activeId) {
          this.pickActive();
        }
      });
      const ws = this.activeId;
      if (ws && !syncStore.bases.has(ws)) {
        return syncStore
          .loadBase(ws)
          .then(() => syncStore.refreshBase(ws))
          .finally(() => this.finishBootAfterWorkspaceList());
      }
      this.finishBootAfterWorkspaceList();
    });
  }

  retryTreeLoad(): void {
    const ws = this.activeId;
    if (!ws) return;
    void syncStore.refreshBase(ws);
  }

  private finishBootPhase(): void {
    runInAction(() => {
      if (!this.activeId) return;
      if (this.treeReady || this.treeLoadFailed) this.booting = false;
    });
  }

  private finishBootAfterWorkspaceList(): void {
    runInAction(() => {
      if (!this.activeId) this.booting = false;
      else if (this.treeReady || this.treeLoadFailed) this.booting = false;
    });
  }

  /** Workspace to hydrate first: URL, then remembered id, then cached list. */
  private resolveInitialWorkspaceId(cachedWorkspaces: Workspace[] | null): string | null {
    if (this.activeId && this.workspaces.some((w) => w.id === this.activeId)) return this.activeId;
    const fromUrl = typeof window !== "undefined" ? parseNotePath(window.location.pathname) : null;
    if (fromUrl) return fromUrl.workspaceId;
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
    } catch {
      /* ignore */
    }
    if (remembered) return remembered;
    return cachedWorkspaces?.[0]?.id ?? null;
  }

  async refreshWorkspaces(): Promise<void> {
    try {
      const { workspaces } = await workspaceApi.list();
      runInAction(() => {
        this.serverWorkspaces = workspaces;
      });
      if (this.userId) void writeCache(`workspaces:${this.userId}`, workspaces, "trees");
    } catch {
      return;
    }
    if (!this.activeId) {
      runInAction(() => this.pickActive());
      if (this.activeId) {
        await syncStore.loadBase(this.activeId);
        void syncStore.refreshBase(this.activeId);
      }
    }
  }

  private pickActive(): void {
    if (this.activeId && this.workspaces.some((w) => w.id === this.activeId)) return;
    const fromUrl =
      typeof window !== "undefined" ? parseNotePath(window.location.pathname) : null;
    if (fromUrl) {
      this.activate(fromUrl.workspaceId);
      return;
    }
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
    } catch {
      /* ignore */
    }
    const next = this.workspaces.find((w) => w.id === remembered) ?? this.workspaces[0];
    if (next) this.activate(next.id);
  }

  private activate(id: string): void {
    this.activeId = id;
    this.liveTitle = null;
    this.loadExpanded();
    try {
      localStorage.setItem(ACTIVE_WORKSPACE_KEY, id);
    } catch {
      /* ignore */
    }
  }

  selectWorkspace(id: string): void {
    this.activate(id);
    void syncStore.loadBase(id).then(() => syncStore.refreshBase(id));
  }

  /** Revalidate the active tree when the window regains focus. */
  revalidate(): void {
    if (!this.activeId || Date.now() - this.lastRevalidate < REVALIDATE_MIN_MS) return;
    this.lastRevalidate = Date.now();
    void syncStore.refreshBase(this.activeId);
  }

  /** Mint a workspace id, queue its create, and switch to it. `seedNote` adds one blank note. */
  createWorkspace(name: string, options?: { seedNote?: boolean }): string {
    const id = crypto.randomUUID();
    syncStore.enqueue(id, { kind: "createWorkspace", name: name.trim().slice(0, 80) });
    syncStore.setBase(id, emptyManifest());
    this.activate(id);
    if (options?.seedNote !== false) this.addNote(null);
    return id;
  }

  onWorkspaceCreated(workspace: Workspace): void {
    if (this.serverWorkspaces.some((w) => w.id === workspace.id)) return;
    this.serverWorkspaces = [...this.serverWorkspaces, workspace];
    if (this.userId) void writeCache(`workspaces:${this.userId}`, this.serverWorkspaces, "trees");
  }

  isPendingWorkspace(workspaceId: string): boolean {
    return syncStore.isPendingCreateWorkspace(workspaceId);
  }

  async renameWorkspace(workspaceId: string, name: string): Promise<string | null> {
    const trimmed = name.trim().slice(0, 80);
    if (!trimmed) return "Name is required.";
    const workspace = this.workspaces.find((w) => w.id === workspaceId);
    if (!workspace) return "Workspace not found.";
    if (workspace.name === trimmed) return null;

    if (this.isPendingWorkspace(workspaceId)) {
      if (!syncStore.updatePendingCreateWorkspaceName(workspaceId, trimmed)) return "Could not rename workspace.";
      return null;
    }

    const previous = workspace.name;
    runInAction(() => {
      this.serverWorkspaces = this.serverWorkspaces.map((w) =>
        w.id === workspaceId ? { ...w, name: trimmed } : w,
      );
    });
    if (this.userId) void writeCache(`workspaces:${this.userId}`, this.serverWorkspaces, "trees");

    try {
      const { workspace: updated } = await workspaceApi.update(workspaceId, trimmed);
      runInAction(() => {
        this.serverWorkspaces = this.serverWorkspaces.map((w) => (w.id === workspaceId ? updated : w));
      });
      if (this.userId) void writeCache(`workspaces:${this.userId}`, this.serverWorkspaces, "trees");
      return null;
    } catch {
      runInAction(() => {
        this.serverWorkspaces = this.serverWorkspaces.map((w) =>
          w.id === workspaceId ? { ...w, name: previous } : w,
        );
      });
      if (this.userId) void writeCache(`workspaces:${this.userId}`, this.serverWorkspaces, "trees");
      return "Could not rename workspace.";
    }
  }

  /**
   * Remove a workspace locally and on the server. Returns the next workspace id to activate, or null.
   */
  async deleteWorkspace(workspaceId: string): Promise<{ nextWorkspaceId: string | null; error: string | null }> {
    if (!this.workspaces.some((w) => w.id === workspaceId)) {
      return { nextWorkspaceId: this.activeId, error: "Workspace not found." };
    }

    const wasActive = this.activeId === workspaceId;
    const remaining = this.workspaces.filter((w) => w.id !== workspaceId);
    const nextWorkspaceId = remaining[0]?.id ?? null;

    if (this.isPendingWorkspace(workspaceId)) {
      syncStore.discardWorkspace(workspaceId);
      runInAction(() => {
        this.serverWorkspaces = this.serverWorkspaces.filter((w) => w.id !== workspaceId);
      });
      uiPreferenceStore.forgetWorkspace(workspaceId);
      if (wasActive) {
        if (nextWorkspaceId) this.activate(nextWorkspaceId);
        else this.activeId = null;
        if (this.openNoteWasIn(workspaceId)) noteStore.close();
      }
      if (this.userId) void writeCache(`workspaces:${this.userId}`, this.serverWorkspaces, "trees");
      return { nextWorkspaceId: wasActive ? nextWorkspaceId : this.activeId, error: null };
    }

    try {
      await workspaceApi.delete(workspaceId);
    } catch {
      return { nextWorkspaceId: this.activeId, error: "Could not delete workspace." };
    }

    syncStore.discardWorkspace(workspaceId);
    runInAction(() => {
      this.serverWorkspaces = this.serverWorkspaces.filter((w) => w.id !== workspaceId);
    });
    uiPreferenceStore.forgetWorkspace(workspaceId);
    if (this.userId) void writeCache(`workspaces:${this.userId}`, this.serverWorkspaces, "trees");

    if (wasActive) {
      if (nextWorkspaceId) {
        this.activate(nextWorkspaceId);
        void syncStore.loadBase(nextWorkspaceId).then(() => syncStore.refreshBase(nextWorkspaceId));
      } else {
        this.activeId = null;
      }
      noteStore.close();
    }

    return { nextWorkspaceId: wasActive ? nextWorkspaceId : this.activeId, error: null };
  }

  private openNoteWasIn(workspaceId: string): boolean {
    return noteStore.openWorkspaceId === workspaceId;
  }

  /** Create a note locally and return its id in the same tick. */
  addNote(parentId: string | null): string | null {
    const workspaceId = this.activeId;
    if (!workspaceId) return null;
    const noteId = crypto.randomUUID();
    const at = new Date().toISOString();
    syncStore.enqueue(workspaceId, { kind: "createNote", noteId, parentId, content: EMPTY_NOTE, at });
    const parent = parentId ? findTreeNode(this.viewTree, parentId) : null;
    if (parent) this.ensureExpanded(parent.path);
    const created = findTreeNode(this.viewTree, noteId);
    if (created) emitFileWrite({ type: "save", root: "notes", path: created.path, content: EMPTY_NOTE });
    return noteId;
  }

  addFolder(parentId: string | null, name: string): string | null {
    const workspaceId = this.activeId;
    if (!workspaceId || !name.trim()) return null;
    const folderId = crypto.randomUUID();
    const at = new Date().toISOString();
    syncStore.enqueue(workspaceId, {
      kind: "createFolder",
      folderId,
      parentId,
      name: name.trim(),
      at,
    });
    const parent = parentId ? findTreeNode(this.viewTree, parentId) : null;
    if (parent) this.ensureExpanded(parent.path);
    return folderId;
  }

  moveNote(noteId: string, targetFolderId: string | null, newFolderName?: string): void {
    const workspaceId = this.activeId;
    if (!workspaceId) return;
    const node = findTreeNode(this.viewTree, noteId);
    if (!node || node.type !== "note") return;

    let folderId = targetFolderId;
    if (newFolderName?.trim()) {
      const created = this.addFolder(targetFolderId, newFolderName.trim());
      if (!created) return;
      folderId = created;
    }

    const entries = syncStore.view(workspaceId).entries;
    const currentParentId = node.parentPath
      ? (entries.find((e) => e.type === "folder" && e.path === node.parentPath)?.id ?? null)
      : null;
    if (currentParentId === folderId && !newFolderName?.trim()) return;

    const oldPath = node.path;
    syncStore.enqueue(workspaceId, { kind: "move", entryId: noteId, parentId: folderId });
    const moved = findTreeNode(this.viewTree, noteId);
    if (moved && moved.path !== oldPath) {
      emitFileWrite({ type: "move", root: "notes", oldPath, newPath: moved.path });
      this.revealNote(noteId);
    }
    if (folderId) {
      const folder = findTreeNode(this.viewTree, folderId);
      if (folder?.type === "folder") this.ensureExpanded(folder.path);
    }
  }

  private async loadNoteContentForDuplicate(workspaceId: string, noteId: string): Promise<string | null> {
    if (noteStore.openNoteId === noteId && noteStore.openWorkspaceId === workspaceId) {
      noteStore.checkpoint();
      return noteStore.content;
    }
    const local = syncStore.latestContent(workspaceId, noteId);
    if (local !== null) return local;
    const cached = await readCache<{ content: string }>(`note:${workspaceId}:${noteId}`, "notes").catch(() => null);
    if (cached?.content) return cached.content;
    try {
      const data = await noteApi.get(workspaceId, noteId);
      return data.content;
    } catch {
      return null;
    }
  }

  async duplicateNote(noteId: string): Promise<string | null> {
    const workspaceId = this.activeId;
    if (!workspaceId) return null;
    const node = findTreeNode(this.viewTree, noteId);
    if (!node || node.type !== "note") return null;

    const content = await this.loadNoteContentForDuplicate(workspaceId, noteId);
    if (content === null) {
      toast.error("Couldn't read this note to duplicate.");
      return null;
    }

    const entries = syncStore.view(workspaceId).entries;
    const siblingNames = entries
      .filter((e) => e.type === "note" && e.parentPath === node.parentPath)
      .map((e) => e.name);
    const title = duplicateTitle(displayEntryName(node.name), siblingNames);
    const nextContent = replaceMarkdownTitle(content, title);
    const newId = crypto.randomUUID();
    const at = new Date().toISOString();
    const parentId = node.parentPath
      ? (entries.find((e) => e.type === "folder" && e.path === node.parentPath)?.id ?? null)
      : null;

    syncStore.enqueue(workspaceId, {
      kind: "createNote",
      noteId: newId,
      parentId,
      content: nextContent,
      at,
    });
    const created = findTreeNode(this.viewTree, newId);
    if (created) emitFileWrite({ type: "save", root: "notes", path: created.path, content: nextContent });
    if (parentId) {
      const folder = findTreeNode(this.viewTree, parentId);
      if (folder?.type === "folder") this.ensureExpanded(folder.path);
    }
    return newId;
  }

  /** Rename a folder. Notes are renamed through their heading (`noteStore.renameNote`). */
  renameFolder(folderId: string, name: string): void {
    const workspaceId = this.activeId;
    const folder = workspaceId ? findTreeNode(this.viewTree, folderId) : null;
    if (!workspaceId || !folder || folder.type !== "folder" || !name.trim()) return;
    const before = notePathsUnder(this.viewTree, folderId);
    syncStore.enqueue(workspaceId, { kind: "rename", entryId: folderId, name: name.trim() });
    const renamed = findTreeNode(this.viewTree, folderId);
    if (renamed && renamed.path !== folder.path) this.moveExpanded(folder.path, renamed.path);
    const after = notePathsUnder(this.viewTree, folderId);
    for (const [id, oldPath] of before) {
      const newPath = after.get(id);
      if (newPath && newPath !== oldPath) emitFileWrite({ type: "move", root: "notes", oldPath, newPath });
    }
  }

  deleteEntry(entryId: string): void {
    const workspaceId = this.activeId;
    if (!workspaceId || !findTreeNode(this.viewTree, entryId)) return;
    const notes = notePathsUnder(this.viewTree, entryId);
    const ids = subtreeIds(this.viewTree, entryId);
    syncStore.enqueueDelete(workspaceId, entryId, ids);
    noteTabsStore.workspace(workspaceId).closeTabsForNotes(notes.keys());
    for (const [noteId, path] of notes) {
      emitFileWrite({ type: "delete", root: "notes", path });
      void deleteCache(`note:${workspaceId}:${noteId}`, "notes");
    }
  }

  applyNoteTitle(noteId: string, title: string): void {
    if (this.liveTitle?.noteId === noteId && this.liveTitle.title === title) return;
    this.liveTitle = { noteId, title };
  }

  private moveExpanded(oldPath: string, newPath: string): void {
    const prefix = `${oldPath}/`;
    const next = new Set<string>();
    for (const path of this.expanded) {
      if (path === oldPath) next.add(newPath);
      else if (path.startsWith(prefix)) next.add(newPath + path.slice(oldPath.length));
      else next.add(path);
    }
    this.expanded = next;
    this.persistExpanded();
  }
}

export const workspaceStore = new WorkspaceStore();

syncStore.subscribe((event) => {
  if (event.type === "workspaceCreated") workspaceStore.onWorkspaceCreated(event.workspace);
});

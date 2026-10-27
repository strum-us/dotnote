import { useCallback, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { observer } from "mobx-react-lite";
import { toast } from "sonner";
import type { TreeNode } from "@shared/types";
import { ImportStatusBar } from "@/components/ImportStatusBar";
import { NewWorkspaceDialog } from "@/components/NewWorkspaceDialog";
import { authStore } from "@/stores/auth-store";
import { importStore } from "@/stores/import-store";
import { noteStore } from "@/stores/note-store";
import { noteTabsStore } from "@/stores/note-tabs-store";
import { syncStore } from "@/stores/sync-store";
import { updateStore } from "@/stores/update-store";
import { workspaceStore } from "@/stores/workspace-store";
import { collectNoteIds } from "@/lib/tree-utils";
import type { SettingsSection } from "@/lib/settings-section";
import {
  type OpenNoteHistory,
  type OpenNoteOptions,
  notePath,
  parseNotePath,
  pushNoteRoute,
  replaceNoteRoute,
} from "@/lib/note-route";
import { parseSettingsPath, pushSettingsRoute, replaceSettingsRoute } from "@/lib/settings-route";
import { AuthScreen } from "@/components/AuthScreen";
import { NoteEditor } from "@/components/NoteEditor";
import { TreeSidebar } from "@/components/TreeSidebar";
import { SettingsSidebar } from "@/components/settings/SettingsSidebar";
import { SettingsMain } from "@/components/settings/SettingsMain";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { DocumentSearchDialog, DocumentSearchProvider, useDocumentSearch, useDocumentSearchHotkey } from "@/document-search";
import { useBlockBrowserFileShortcuts } from "@/hooks/useBlockBrowserFileShortcuts";
import { setRecentRecorder, setSearchNavigator } from "@/lib/search-nav";
import { uiPreferenceStore } from "@/stores/ui-preference-store";
import { cn } from "@/lib/utils";

const SIDEBAR_WIDTH = 240;

function firstNoteId(nodes: TreeNode[]): string | null {
  for (const node of nodes) {
    if (node.type === "note") return node.id;
    const nested = node.children ? firstNoteId(node.children) : null;
    if (nested) return nested;
  }
  return null;
}

function settingsReturnPath(workspaceId: string | null, activeNoteId: string | null): string {
  if (workspaceId && activeNoteId) return notePath(workspaceId, activeNoteId);
  if (workspaceId) return notePath(workspaceId);
  return "/";
}

export const App = observer(function App() {
  const [workspaceDialog, setWorkspaceDialog] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(() =>
    typeof window !== "undefined" ? parseSettingsPath(window.location.pathname) : null,
  );
  const [routePath, setRoutePath] = useState(() =>
    typeof window !== "undefined" ? window.location.pathname : "/",
  );
  const bootRouteAppliedRef = useRef<string | null>(null);
  const lastNoteRouteAppliedRef = useRef<string | null>(null);
  const importOpenedRef = useRef<string | null>(null);

  const workspaceId = workspaceStore.activeId;
  const tabsSession = workspaceId ? noteTabsStore.workspace(workspaceId) : null;
  const activeNoteId = tabsSession?.activeNoteId ?? null;
  const userId = authStore.user?.id ?? null;
  const treeReady = workspaceStore.treeReady;
  const viewTree = workspaceStore.viewTree;
  const sidebarCollapsed = uiPreferenceStore.sidebarCollapsed;

  useBlockBrowserFileShortcuts();

  useEffect(() => {
    void authStore.bootstrap();
  }, []);

  useEffect(() => {
    if (!userId) return;
    const syncDisabled = authStore.user?.syncDisabled ?? false;
    void workspaceStore.boot(userId, syncDisabled).then(() => importStore.boot(userId));
  }, [userId, authStore.user?.syncDisabled]);

  useEffect(() => {
    if (!userId) return;
    return updateStore.boot();
  }, [userId]);

  useEffect(() => {
    const syncFromUrl = () => setRoutePath(window.location.pathname);
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  useEffect(() => {
    const fromPath = parseSettingsPath(routePath);
    setSettingsSection(fromPath);
    if (fromPath) uiPreferenceStore.setSidebarCollapsed(false);
  }, [routePath]);

  useEffect(
    () =>
      syncStore.subscribe((event) => {
        if (event.type === "rejected") toast.error("The server refused a change, so it was undone here.");
      }),
    [],
  );

  const rememberRoute = useCallback(() => {
    const next = window.location.pathname;
    lastNoteRouteAppliedRef.current = next;
    setRoutePath((prev) => (prev === next ? prev : next));
  }, []);

  const syncNoteUrl = useCallback(
    (wsId: string, noteId: string, history: OpenNoteHistory) => {
      if (settingsSection) return;
      if (history === "push") pushNoteRoute(wsId, noteId);
      else if (history === "replace") replaceNoteRoute(wsId, noteId);
      else return;
      rememberRoute();
    },
    [settingsSection, rememberRoute],
  );

  const openNote = useCallback(
    (
      noteId: string,
      mode: "preview" | "permanent" = "preview",
      opts?: OpenNoteOptions,
    ) => {
      if (!workspaceId) return;
      noteStore.checkpoint();
      noteTabsStore.workspace(workspaceId).openNote(noteId, {
        mode,
        skipHistory: opts?.skipHistory,
      });
      workspaceStore.revealNote(noteId);

      const history: OpenNoteHistory = opts?.skipHistory
        ? "replace"
        : (opts?.history ?? "push");
      syncNoteUrl(workspaceId, noteId, history);
    },
    [workspaceId, syncNoteUrl],
  );

  useEffect(() => {
    if (!workspaceId || !treeReady || settingsSection) return;

    const parsed = parseNotePath(routePath);
    if (parsed && parsed.workspaceId !== workspaceId) {
      if (workspaceStore.workspaces.some((w) => w.id === parsed.workspaceId)) {
        noteStore.checkpoint();
        workspaceStore.selectWorkspace(parsed.workspaceId);
      }
      return;
    }

    const session = noteTabsStore.attach(workspaceId);
    const valid = collectNoteIds(viewTree);
    session.pruneMissingNotes(valid);

    const applyUrlNote = parsed?.kind === "note" && parsed.workspaceId === workspaceId && valid.has(parsed.noteId);

    // Title saves rebuild viewTree. After the first hydrate, only a real URL
    // change (click, search, back/forward) may switch the open note.
    if (bootRouteAppliedRef.current === workspaceId) {
      if (lastNoteRouteAppliedRef.current === routePath) {
        const importingHere =
          importStore.job?.workspaceId === workspaceId &&
          importStore.job.phase !== "failed" &&
          importStore.job.phase !== "needs-permission";
        if (importingHere && session.tabs.length === 0 && importOpenedRef.current !== workspaceId) {
          const target = firstNoteId(viewTree);
          if (target) {
            importOpenedRef.current = workspaceId;
            session.openNote(target, { mode: "preview", skipHistory: true });
            workspaceStore.revealNote(target);
            replaceNoteRoute(workspaceId, target);
            rememberRoute();
          }
        }
        return;
      }
      if (applyUrlNote && session.activeNoteId !== parsed.noteId) {
        session.openNote(parsed.noteId, { mode: "permanent", skipHistory: true });
        workspaceStore.revealNote(parsed.noteId);
      }
      lastNoteRouteAppliedRef.current = routePath;
      return;
    }

    if (applyUrlNote) {
      if (session.activeNoteId !== parsed.noteId) {
        session.openNote(parsed.noteId, { mode: "permanent", skipHistory: true });
        workspaceStore.revealNote(parsed.noteId);
      }
      replaceNoteRoute(workspaceId, parsed.noteId);
      rememberRoute();
      bootRouteAppliedRef.current = workspaceId;
      return;
    }

    if (session.tabs.length === 0) {
      const last = uiPreferenceStore.getLastActiveNoteId(workspaceId);
      const target = (last && valid.has(last) ? last : null) ?? firstNoteId(viewTree);
      if (target) {
        session.openNote(target, { mode: "preview", skipHistory: true });
        replaceNoteRoute(workspaceId, target);
      }
    } else {
      const active = session.activeNoteId;
      if (active && valid.has(active)) replaceNoteRoute(workspaceId, active);
    }

    rememberRoute();
    bootRouteAppliedRef.current = workspaceId;
  }, [
    workspaceId,
    treeReady,
    viewTree,
    settingsSection,
    routePath,
    rememberRoute,
    importStore.job?.phase,
    importStore.job?.workspaceId,
  ]);

  useEffect(() => {
    if (bootRouteAppliedRef.current && bootRouteAppliedRef.current !== workspaceId) {
      bootRouteAppliedRef.current = null;
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || !activeNoteId || settingsSection) {
      if (!settingsSection) noteStore.close();
      return;
    }
    workspaceStore.revealNote(activeNoteId);
    void noteStore.open(workspaceId, activeNoteId);
  }, [workspaceId, activeNoteId, settingsSection]);

  const openFromSearch = useCallback((id: string) => openNote(id, "permanent"), [openNote]);

  const handleBack = useCallback(() => {
    window.history.back();
  }, []);

  const handleForward = useCallback(() => {
    window.history.forward();
  }, []);

  const openSettings = useCallback(
    (section: SettingsSection = "general") => {
      noteStore.checkpoint();
      uiPreferenceStore.setSidebarCollapsed(false);
      setSettingsSection(section);
      pushSettingsRoute(section);
    },
    [],
  );

  const closeSettings = useCallback(() => {
    setSettingsSection(null);
    pushSettingsRoute(null, settingsReturnPath(workspaceId, activeNoteId));
    rememberRoute();
  }, [workspaceId, activeNoteId, rememberRoute]);

  const handleWorkspaceDeleted = useCallback(
    (nextWorkspaceId: string | null) => {
      bootRouteAppliedRef.current = null;
      lastNoteRouteAppliedRef.current = null;
      if (nextWorkspaceId) {
        replaceNoteRoute(nextWorkspaceId, null);
        rememberRoute();
        return;
      }
      setSettingsSection(null);
      replaceSettingsRoute(null, "/");
      rememberRoute();
    },
    [rememberRoute],
  );

  const selectSettingsSection = useCallback((section: SettingsSection) => {
    setSettingsSection(section);
    pushSettingsRoute(section);
  }, []);

  if (!authStore.booted) {
    return <div className="flex h-full items-center justify-center text-dim">Loading…</div>;
  }
  if (!authStore.user) return <AuthScreen />;

  return (
    <DocumentSearchProvider vaultId={workspaceId}>
      <SearchBridge onOpen={openFromSearch} />
      <div className="flex h-full min-h-0 flex-col bg-canvas text-ink">
        <ImportStatusBar />
        <div className="flex min-h-0 flex-1">
        {workspaceId ? (
          <>
            <div
              className={cn(
                "flex shrink-0 overflow-hidden transition-[width] duration-300 ease-out",
                sidebarCollapsed && "pointer-events-none",
              )}
              style={{ width: sidebarCollapsed ? 0 : SIDEBAR_WIDTH }}
              aria-hidden={sidebarCollapsed}
            >
              {settingsSection ? (
                <SettingsSidebar
                  active={settingsSection}
                  onBack={closeSettings}
                  onSelect={selectSettingsSection}
                />
              ) : (
                <TreeSidebar
                  selectedNoteId={activeNoteId}
                  onPreviewNote={(id) => openNote(id, "preview")}
                  onPermanentNote={(id) => openNote(id, "permanent")}
                  onCreatedNote={(id) => openNote(id, "permanent")}
                  canBack={tabsSession?.canBack ?? false}
                  canForward={tabsSession?.canForward ?? false}
                  onBack={handleBack}
                  onForward={handleForward}
                  onCollapseSidebar={() => uiPreferenceStore.toggleSidebarCollapsed()}
                  onSelectWorkspace={(id) => {
                    noteStore.checkpoint();
                    bootRouteAppliedRef.current = null;
                    lastNoteRouteAppliedRef.current = null;
                    workspaceStore.selectWorkspace(id);
                    replaceNoteRoute(id, null);
                    rememberRoute();
                  }}
                  onNewWorkspace={() => setWorkspaceDialog(true)}
                  onOpenSettings={() => openSettings("general")}
                />
              )}
            </div>
            <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-well">
              {settingsSection ? (
                <SettingsMain
                  section={settingsSection}
                  onSignOut={() => {
                    setSettingsSection(null);
                    replaceSettingsRoute(null, "/");
                  }}
                  onWorkspaceDeleted={handleWorkspaceDeleted}
                />
              ) : (
                <NoteEditor
                  workspaceId={workspaceId}
                  onSwitchNote={(id, opts) => openNote(id, "preview", opts)}
                  sidebarCollapsed={sidebarCollapsed}
                  onExpandSidebar={() => uiPreferenceStore.setSidebarCollapsed(false)}
                  canBack={tabsSession?.canBack ?? false}
                  canForward={tabsSession?.canForward ?? false}
                  onBack={handleBack}
                  onForward={handleForward}
                />
              )}
            </main>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3">
            <p className="text-sm text-dim">Create a workspace to start.</p>
            <Button onClick={() => setWorkspaceDialog(true)}>
              <Plus /> New workspace
            </Button>
          </div>
        )}
        </div>
        <NewWorkspaceDialog
          open={workspaceDialog}
          onOpenChange={setWorkspaceDialog}
          onCreated={(id) => {
            bootRouteAppliedRef.current = null;
            lastNoteRouteAppliedRef.current = null;
            replaceNoteRoute(id, null);
            rememberRoute();
          }}
        />
        <Toaster />
      </div>
    </DocumentSearchProvider>
  );
});

const SearchBridge = observer(function SearchBridge({ onOpen }: { onOpen: (noteId: string) => void }) {
  const store = useDocumentSearch();
  useDocumentSearchHotkey();
  useEffect(() => {
    setSearchNavigator(onOpen);
    setRecentRecorder((root, path, title) => {
      void store.recordRecent(root, path, title);
    });
    return () => {
      setSearchNavigator(null);
      setRecentRecorder(null);
    };
  }, [onOpen, store]);
  return <DocumentSearchDialog />;
});

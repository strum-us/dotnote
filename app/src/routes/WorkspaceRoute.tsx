import { useCallback, useEffect, useRef } from "react";
import { Plus } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useLocation, useNavigate, useOutletContext, useParams } from "react-router-dom";
import type { ShellOutletContext } from "@/routes/AppShell";

import { NoteEditor } from "@/components/NoteEditor";
import { TreeSidebar } from "@/components/TreeSidebar";
import { Button } from "@/components/ui/button";
import { CenterLoading, TreeLoadFailed } from "@/components/WorkspaceLoading";
import type { TreeNode } from "@shared/types";
import {
  type OpenNoteHistory,
  type OpenNoteOptions,
  notePath,
  parseNotePath,
} from "@/lib/note-route";
import { collectNoteIds } from "@/lib/tree-utils";
import { isSettingsPath, settingsPath } from "@/routes/paths";
import { importStore } from "@/stores/import-store";
import { noteStore } from "@/stores/note-store";
import { noteTabsStore } from "@/stores/note-tabs-store";
import { uiPreferenceStore } from "@/stores/ui-preference-store";
import { workspaceStore } from "@/stores/workspace-store";
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

export const WorkspaceRoute = observer(function WorkspaceRoute() {
  const { openWorkspaceDialog } = useOutletContext<ShellOutletContext>();
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const routePath = location.pathname;
  const inSettings = isSettingsPath(routePath);

  const bootRouteAppliedRef = useRef<string | null>(null);
  const lastNoteRouteAppliedRef = useRef<string | null>(null);
  const importOpenedRef = useRef<string | null>(null);

  const workspaceId = workspaceStore.activeId;
  const tabsSession = workspaceId ? noteTabsStore.workspace(workspaceId) : null;
  const activeNoteId = tabsSession?.activeNoteId ?? null;
  const treeReady = workspaceStore.treeReady;
  const treeLoadFailed = workspaceStore.treeLoadFailed;
  const viewTree = workspaceStore.viewTree;
  const sidebarCollapsed = uiPreferenceStore.sidebarCollapsed;

  const rememberRoute = useCallback(() => {
    lastNoteRouteAppliedRef.current = routePath;
  }, [routePath]);

  const syncNoteUrl = useCallback(
    (wsId: string, noteId: string, history: OpenNoteHistory) => {
      if (inSettings) return;
      const next = notePath(wsId, noteId);
      if (history === "push") navigate(next);
      else if (history === "replace") navigate(next, { replace: true });
      else return;
      rememberRoute();
    },
    [inSettings, navigate, rememberRoute],
  );

  const openNote = useCallback(
    (noteId: string, mode: "preview" | "permanent" = "preview", opts?: OpenNoteOptions) => {
      if (!workspaceId) return;
      noteStore.checkpoint();
      noteTabsStore.workspace(workspaceId).openNote(noteId, {
        mode,
        skipHistory: opts?.skipHistory,
      });
      workspaceStore.revealNote(noteId);

      const history: OpenNoteHistory = opts?.skipHistory ? "replace" : (opts?.history ?? "push");
      syncNoteUrl(workspaceId, noteId, history);
    },
    [workspaceId, syncNoteUrl],
  );

  useEffect(() => {
    if (!workspaceId || !treeReady || inSettings) return;

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

    const applyUrlNote =
      parsed?.kind === "note" && parsed.workspaceId === workspaceId && valid.has(parsed.noteId);

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
            navigate(notePath(workspaceId, target), { replace: true });
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
      navigate(notePath(workspaceId, parsed.noteId), { replace: true });
      rememberRoute();
      bootRouteAppliedRef.current = workspaceId;
      return;
    }

    if (session.tabs.length === 0) {
      const last = uiPreferenceStore.getLastActiveNoteId(workspaceId);
      const target = (last && valid.has(last) ? last : null) ?? firstNoteId(viewTree);
      if (target) {
        session.openNote(target, { mode: "preview", skipHistory: true });
        navigate(notePath(workspaceId, target), { replace: true });
      }
    } else {
      const active = session.activeNoteId;
      if (active && valid.has(active)) navigate(notePath(workspaceId, active), { replace: true });
    }

    rememberRoute();
    bootRouteAppliedRef.current = workspaceId;
  }, [
    workspaceId,
    treeReady,
    viewTree,
    inSettings,
    routePath,
    rememberRoute,
    navigate,
    importStore.job?.phase,
    importStore.job?.workspaceId,
  ]);

  useEffect(() => {
    if (bootRouteAppliedRef.current && bootRouteAppliedRef.current !== workspaceId) {
      bootRouteAppliedRef.current = null;
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || !activeNoteId || inSettings) {
      if (!inSettings) noteStore.close();
      return;
    }
    workspaceStore.revealNote(activeNoteId);
    void noteStore.open(workspaceId, activeNoteId);
  }, [workspaceId, activeNoteId, inSettings]);

  useEffect(() => {
    const urlWs = params.workspaceId;
    if (!urlWs || !workspaceStore.workspaces.length) return;
    if (workspaceStore.activeId === urlWs) return;
    if (!workspaceStore.workspaces.some((w) => w.id === urlWs)) return;
    noteStore.checkpoint();
    bootRouteAppliedRef.current = null;
    lastNoteRouteAppliedRef.current = null;
    workspaceStore.selectWorkspace(urlWs);
  }, [params.workspaceId]);

  const handleBack = useCallback(() => navigate(-1), [navigate]);
  const handleForward = useCallback(() => navigate(1), [navigate]);

  const openSettings = useCallback(() => {
    noteStore.checkpoint();
    uiPreferenceStore.setSidebarCollapsed(false);
    navigate(settingsPath("general"));
  }, [navigate]);

  if (!workspaceId) {
    if (workspaceStore.booting) return <CenterLoading label="Loading workspace…" />;
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <p className="text-sm text-dim">Create a workspace to start.</p>
        <Button onClick={openWorkspaceDialog}>
          <Plus /> New workspace
        </Button>
      </div>
    );
  }

  return (
    <>
      <div
        className={cn(
          "flex shrink-0 overflow-hidden transition-[width] duration-300 ease-out",
          sidebarCollapsed && "pointer-events-none",
        )}
        style={{ width: sidebarCollapsed ? 0 : SIDEBAR_WIDTH }}
        aria-hidden={sidebarCollapsed}
      >
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
            navigate(notePath(id), { replace: true });
            rememberRoute();
          }}
          onNewWorkspace={openWorkspaceDialog}
          onOpenSettings={openSettings}
        />
      </div>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-well">
        {treeLoadFailed ? (
          <TreeLoadFailed onRetry={() => workspaceStore.retryTreeLoad()} />
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
  );
});

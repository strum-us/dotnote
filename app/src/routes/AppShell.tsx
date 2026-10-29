import { useCallback, useEffect, useState } from "react";
import { observer } from "mobx-react-lite";
import { useNavigate } from "@/lib/next-router-compat";
import { ShellProvider, type ShellOutletContext } from "@/lib/shell-context";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { AuthScreen } from "@/components/AuthScreen";
import { ImportStatusBar } from "@/components/ImportStatusBar";
import { NewWorkspaceDialog } from "@/components/NewWorkspaceDialog";
import { Toaster } from "@/components/ui/sonner";
import { DocumentSearchDialog, DocumentSearchProvider, useDocumentSearch, useDocumentSearchHotkey } from "@/document-search";
import { useBlockBrowserFileShortcuts } from "@/hooks/useBlockBrowserFileShortcuts";
import { notePath } from "@/lib/note-route";
import { setRecentRecorder, setSearchNavigator } from "@/lib/search-nav";
import { authStore } from "@/stores/auth-store";
import { importStore } from "@/stores/import-store";
import { syncStore } from "@/stores/sync-store";
import { updateStore } from "@/stores/update-store";
import { workspaceStore } from "@/stores/workspace-store";

export type { ShellOutletContext };

export const AppShell = observer(function AppShell({ children }: { children: ReactNode }) {
  const [workspaceDialog, setWorkspaceDialog] = useState(false);
  const navigate = useNavigate();
  const userId = authStore.user?.id ?? null;

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

  useEffect(
    () =>
      syncStore.subscribe((event) => {
        if (event.type === "rejected") toast.error("The server refused a change, so it was undone here.");
      }),
    [],
  );

  const openFromSearch = useCallback(
    (noteId: string) => {
      const workspaceId = workspaceStore.activeId;
      if (!workspaceId) return;
      navigate(notePath(workspaceId, noteId));
    },
    [navigate],
  );

  if (!authStore.booted) {
    return <div className="flex h-full items-center justify-center text-dim">Loading…</div>;
  }
  if (!authStore.user) return <AuthScreen />;

  return (
    <DocumentSearchProvider vaultId={workspaceStore.activeId}>
      <SearchBridge onOpen={openFromSearch} />
      <div className="flex h-full min-h-0 flex-col bg-canvas text-ink">
        <ImportStatusBar />
        <div className="flex min-h-0 flex-1">
          <ShellProvider value={{ openWorkspaceDialog: () => setWorkspaceDialog(true) }}>
            {children}
          </ShellProvider>
        </div>
        <NewWorkspaceDialog
          open={workspaceDialog}
          onOpenChange={setWorkspaceDialog}
          onCreated={(id) => {
            navigate(notePath(id), { replace: true });
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

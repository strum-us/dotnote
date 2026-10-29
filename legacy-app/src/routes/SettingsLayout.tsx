import { observer } from "mobx-react-lite";
import { Outlet, useNavigate } from "react-router-dom";

import { SettingsSidebar } from "@/components/settings/SettingsSidebar";
import { noteStore } from "@/stores/note-store";
import { noteTabsStore } from "@/stores/note-tabs-store";
import { uiPreferenceStore } from "@/stores/ui-preference-store";
import { workspaceStore } from "@/stores/workspace-store";
import { notePath } from "@/lib/note-route";
import { useEffect } from "react";

function settingsReturnPath(): string {
  const workspaceId = workspaceStore.activeId;
  const activeNoteId = workspaceId ? noteTabsStore.workspace(workspaceId).activeNoteId : null;
  if (workspaceId && activeNoteId) return notePath(workspaceId, activeNoteId);
  if (workspaceId) return notePath(workspaceId);
  return "/";
}

export const SettingsLayout = observer(function SettingsLayout() {
  const navigate = useNavigate();

  useEffect(() => {
    uiPreferenceStore.setSidebarCollapsed(false);
    noteStore.close();
  }, []);

  const closeSettings = () => {
    noteStore.checkpoint();
    navigate(settingsReturnPath());
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <SettingsSidebar onBack={closeSettings} />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto bg-well">
        <Outlet />
      </main>
    </div>
  );
});

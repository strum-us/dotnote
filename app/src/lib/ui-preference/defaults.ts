import type { WorkspaceUIPreferences } from "@/lib/types/ui-preference";

export function createEmptyWorkspacePref(workspaceId: string): WorkspaceUIPreferences {
  return {
    workspaceId,
    updatedAt: Date.now(),
    notes: {
      tabs: [],
      noteUi: {},
      sidebarExpandedPaths: [],
    },
  };
}

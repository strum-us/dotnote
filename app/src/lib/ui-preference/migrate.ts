import { UI_PREFERENCE_SCHEMA_VERSION } from "@/lib/ui-preference/build-version";
import { createEmptyWorkspacePref } from "@/lib/ui-preference/defaults";
import type { WorkspaceUIPreferences } from "@/lib/types/ui-preference";

function normalizeWorkspacePref(
  workspaceId: string,
  raw: Partial<WorkspaceUIPreferences> | undefined,
): WorkspaceUIPreferences {
  const base = createEmptyWorkspacePref(workspaceId);
  if (!raw || typeof raw !== "object") return base;

  return {
    ...base,
    ...raw,
    workspaceId,
    notes: {
      ...base.notes,
      ...raw.notes,
      tabs: raw.notes?.tabs ?? base.notes.tabs,
      noteUi: raw.notes?.noteUi ?? base.notes.noteUi,
      sidebarExpandedPaths: raw.notes?.sidebarExpandedPaths ?? base.notes.sidebarExpandedPaths,
    },
  };
}

export function migrateUIPreferenceData(
  workspaceId: string,
  data: unknown,
  fromVersion: number,
): WorkspaceUIPreferences {
  let current = normalizeWorkspacePref(workspaceId, data as Partial<WorkspaceUIPreferences>);

  for (let v = fromVersion; v < UI_PREFERENCE_SCHEMA_VERSION; v++) {
    switch (v) {
      case 0:
      case 1:
        current = normalizeWorkspacePref(workspaceId, current);
        break;
      default:
        current = normalizeWorkspacePref(workspaceId, current);
        break;
    }
  }

  return current;
}

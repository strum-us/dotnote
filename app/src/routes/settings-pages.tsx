import { useNavigate } from "react-router-dom";

import { AccountSettings } from "@/components/settings/sections/AccountSettings";
import { GeneralSettings } from "@/components/settings/sections/GeneralSettings";
import { workspaceStore } from "@/stores/workspace-store";
import { notePath } from "@/lib/note-route";

export function GeneralSettingsPage() {
  const navigate = useNavigate();
  return (
    <GeneralSettings
      onWorkspaceDeleted={(nextWorkspaceId) => {
        if (nextWorkspaceId) {
          navigate(notePath(nextWorkspaceId), { replace: true });
          return;
        }
        navigate("/", { replace: true });
      }}
    />
  );
}

export function AccountSettingsPage() {
  const navigate = useNavigate();
  return <AccountSettings onSignOut={() => navigate("/", { replace: true })} />;
}

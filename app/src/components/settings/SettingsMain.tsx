import type { SettingsSection } from "@/lib/settings-section";
import { AccountSettings } from "@/components/settings/sections/AccountSettings";
import { AiSettings } from "@/components/settings/sections/AiSettings";
import { CloudflareSettings } from "@/components/settings/sections/CloudflareSettings";
import { GeneralSettings } from "@/components/settings/sections/GeneralSettings";
import { ImageSettings } from "@/components/settings/sections/ImageSettings";

export function SettingsMain({
  section,
  onSignOut,
  onWorkspaceDeleted,
}: {
  section: SettingsSection;
  onSignOut?: () => void;
  onWorkspaceDeleted?: (nextWorkspaceId: string | null) => void;
}) {
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto bg-well">
      {section === "general" ? <GeneralSettings onWorkspaceDeleted={onWorkspaceDeleted} /> : null}
      {section === "ai" ? <AiSettings /> : null}
      {section === "images" ? <ImageSettings /> : null}
      {section === "cloudflare" ? <CloudflareSettings /> : null}
      {section === "account" ? <AccountSettings onSignOut={onSignOut} /> : null}
    </main>
  );
}

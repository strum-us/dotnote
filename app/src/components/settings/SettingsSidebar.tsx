import { ArrowLeft, Cloud, Image, Info, Sparkles, UserRound } from "lucide-react";

import type { SettingsSection } from "@/lib/settings-section";
import { cn } from "@/lib/utils";

const workspaceItems: { id: SettingsSection; label: string; icon: typeof Info }[] = [
  { id: "general", label: "General", icon: Info },
  { id: "ai", label: "AI", icon: Sparkles },
  { id: "images", label: "Images", icon: Image },
  { id: "cloudflare", label: "Cloudflare", icon: Cloud },
];

const accountItem = { id: "account" as const, label: "Account", icon: UserRound };

function NavButton({
  item,
  active,
  onSelect,
}: {
  item: { id: SettingsSection; label: string; icon: typeof Info };
  active: SettingsSection;
  onSelect: (section: SettingsSection) => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        active === item.id ? "bg-raised font-medium text-ink" : "text-dim hover:bg-raised-hover hover:text-ink",
      )}
    >
      <Icon className="size-4 shrink-0" />
      {item.label}
    </button>
  );
}

export function SettingsSidebar({
  active,
  onBack,
  onSelect,
}: {
  active: SettingsSection;
  onBack: () => void;
  onSelect: (section: SettingsSection) => void;
}) {
  return (
    <aside className="flex h-full w-60 shrink-0 select-none flex-col border-r border-divider bg-sidebar">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-2 border-b border-divider px-3 py-2.5 text-sm font-medium hover:bg-raised-hover"
      >
        <ArrowLeft className="size-4" />
        Back to docs
      </button>
      <nav className="flex flex-col gap-0.5 p-2">
        {workspaceItems.map((item) => (
          <NavButton key={item.id} item={item} active={active} onSelect={onSelect} />
        ))}
      </nav>
      <div className="mt-auto border-t border-divider p-2">
        <NavButton item={accountItem} active={active} onSelect={onSelect} />
      </div>
    </aside>
  );
}

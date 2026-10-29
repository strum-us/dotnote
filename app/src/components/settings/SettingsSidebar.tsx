import { ArrowLeft, ArrowUpCircle, Cloud, Image, Info, Sparkles, UserRound } from "lucide-react";
import { NavLink } from "@/lib/next-router-compat";

import { cn } from "@/lib/utils";
import { settingsPath, type SettingsSection } from "@/routes/paths";

const workspaceItems: { id: SettingsSection; label: string; icon: typeof Info; end?: boolean }[] = [
  { id: "general", label: "General", icon: Info, end: true },
  { id: "ai", label: "AI", icon: Sparkles },
  { id: "images", label: "Images", icon: Image },
  { id: "cloudflare", label: "Cloudflare", icon: Cloud },
  { id: "update", label: "Updates", icon: ArrowUpCircle },
];

const accountItem = { id: "account" as const, label: "Account", icon: UserRound };

function SidebarLink({
  to,
  end,
  label,
  icon: Icon,
}: {
  to: string;
  end?: boolean;
  label: string;
  icon: typeof Info;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
          isActive ? "bg-raised font-medium text-ink" : "text-dim hover:bg-raised-hover hover:text-ink",
        )
      }
    >
      <Icon className="size-4 shrink-0" />
      {label}
    </NavLink>
  );
}

export function SettingsSidebar({ onBack }: { onBack: () => void }) {
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
          <SidebarLink
            key={item.id}
            to={settingsPath(item.id)}
            end={item.end}
            label={item.label}
            icon={item.icon}
          />
        ))}
      </nav>
      <div className="mt-auto border-t border-divider p-2">
        <SidebarLink to={settingsPath("account")} label={accountItem.label} icon={accountItem.icon} end />
      </div>
    </aside>
  );
}

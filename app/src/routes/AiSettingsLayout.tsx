import { NavLink } from "@/lib/next-router-compat";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import {
  aiSettingsImagePath,
  aiSettingsLogsPath,
  aiSettingsTextPath,
} from "@/routes/paths";

const tabClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "inline-flex items-center justify-center whitespace-nowrap border-r border-divider px-3 py-1.5 text-compact font-medium outline-none select-none last:border-r-0",
    "text-muted-foreground hover:bg-raised hover:text-ink",
    isActive && "border-b-2 border-b-accent-color bg-well font-semibold text-ink",
  );

export function AiSettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-divider bg-panel-header px-6 pt-4 pb-0">
        <nav className="inline-flex h-8 items-stretch border border-divider bg-panel-header">
          <NavLink to={aiSettingsTextPath()} end className={tabClass}>
            AI
          </NavLink>
          <NavLink to={aiSettingsImagePath()} className={tabClass}>
            AI Image
          </NavLink>
          <NavLink to={aiSettingsLogsPath()} className={tabClass}>
            Log
          </NavLink>
        </nav>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {children}
      </div>
    </div>
  );
}

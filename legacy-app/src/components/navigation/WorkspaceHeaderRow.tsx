import { ChevronDown, Layers, Plus } from "lucide-react";
import { observer } from "mobx-react-lite";

import { SidebarChromeNav } from "@/components/navigation/SidebarChromeNav";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { workspaceStore } from "@/stores/workspace-store";
import { cn } from "@/lib/utils";

export const WorkspaceHeaderRow = observer(function WorkspaceHeaderRow({
  workspaceId,
  canBack,
  canForward,
  onBack,
  onForward,
  onCollapse,
  onSelectWorkspace,
  onNewWorkspace,
  className,
}: {
  workspaceId: string | null;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onCollapse: () => void;
  onSelectWorkspace: (id: string) => void;
  onNewWorkspace: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-0.5 px-1.5 pb-0.5 pt-1.5", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-7 min-w-0 flex-1 justify-start gap-1.5 px-2 text-[13px] font-semibold text-ink">
            <Layers className="size-3.5 shrink-0" />
            <span className="truncate">{workspaceStore.activeWorkspace?.name ?? "Workspace"}</span>
            <ChevronDown className="size-3.5 shrink-0 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {workspaceStore.workspaces.map((workspace) => (
            <DropdownMenuItem key={workspace.id} onClick={() => onSelectWorkspace(workspace.id)}>
              <Layers className={workspace.id === workspaceId ? "text-accent-color" : "text-dim"} />
              <span className="truncate">{workspace.name}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onNewWorkspace}>
            <Plus /> New workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SidebarChromeNav
        canBack={canBack}
        canForward={canForward}
        onBack={onBack}
        onForward={onForward}
        onCollapse={onCollapse}
      />
    </div>
  );
});

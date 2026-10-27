import { ChevronLeft, ChevronRight, PanelLeftClose } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SidebarChromeNav({
  canBack,
  canForward,
  onBack,
  onForward,
  onCollapse,
  className,
}: {
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onCollapse: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex shrink-0 items-center gap-0.5", className)}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6"
        aria-label="Previous"
        disabled={!canBack}
        onClick={onBack}
      >
        <ChevronLeft className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6"
        aria-label="Next"
        disabled={!canForward}
        onClick={onForward}
      >
        <ChevronRight className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6"
        aria-label="Collapse sidebar"
        title="Collapse sidebar"
        onClick={onCollapse}
      >
        <PanelLeftClose className="size-3.5" />
      </Button>
    </div>
  );
}

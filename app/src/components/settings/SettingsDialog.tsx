import { useEffect, useState } from "react";
import { Cloud, Image } from "lucide-react";

import { CloudflareSettings } from "@/components/settings/sections/CloudflareSettings";
import { ImageSettings } from "@/components/settings/sections/ImageSettings";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type SettingsSection = "images" | "cloudflare";

const NAV: { id: SettingsSection; label: string; icon: typeof Image }[] = [
  { id: "images", label: "Images", icon: Image },
  { id: "cloudflare", label: "Cloudflare", icon: Cloud },
];

export function SettingsDialog({
  open,
  onOpenChange,
  section: initialSection = "images",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section?: SettingsSection;
}) {
  const [section, setSection] = useState<SettingsSection>(initialSection);

  useEffect(() => {
    if (open) setSection(initialSection);
  }, [open, initialSection]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(640px,85vh)] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-divider px-4 py-3">
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-divider bg-panel-header p-2">
            {NAV.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                  section === id ? "bg-raised font-medium text-ink" : "text-dim hover:bg-raised/60",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </button>
            ))}
          </aside>
          <div className="min-w-0 flex-1 overflow-auto">
            {section === "images" ? <ImageSettings /> : null}
            {section === "cloudflare" ? <CloudflareSettings /> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

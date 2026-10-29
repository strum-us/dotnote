import { cn } from "@/lib/utils";
import type { SyncState } from "@/stores/sync-store";

const LABELS: Record<SyncState, string> = {
  local: "Not synced yet",
  syncing: "Syncing…",
  synced: "Synced",
};

/**
 * Marker for an entry that is not on the server yet. `local` is a solid dot,
 * `syncing` a pulsing ring; `synced` keeps the slot empty so labels never shift.
 */
export function SyncIndicator({ state, className }: { state: SyncState; className?: string }) {
  if (state === "synced") return <span className={cn("size-1.5 shrink-0", className)} aria-hidden />;
  return (
    <span
      role="status"
      title={LABELS[state]}
      aria-label={LABELS[state]}
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        state === "local" ? "bg-accent-color" : "animate-pulse border border-accent-color",
        className,
      )}
    />
  );
}

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CenterLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex h-full flex-1 items-center justify-center text-sm text-dim">{label}</div>
  );
}

export function TreeListSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-1 px-2 py-1", className)} aria-busy aria-label="Loading docs">
      {Array.from({ length: 8 }, (_, i) => (
        <div
          key={i}
          className="mx-0 h-7 animate-pulse rounded-md bg-raised"
          style={{ marginLeft: (i % 3) * 12, width: `${68 + (i % 4) * 8}%` }}
        />
      ))}
    </div>
  );
}

export function EditorContentSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-3 bg-well p-8" aria-busy aria-label="Loading note">
      <div className="h-7 w-2/5 max-w-md animate-pulse rounded bg-raised" />
      <div className="mt-2 space-y-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-4 animate-pulse rounded bg-raised" style={{ width: `${92 - i * 8}%` }} />
        ))}
      </div>
    </div>
  );
}

export function TreeLoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
      <p className="text-sm text-dim">Couldn’t load this workspace. Check your connection and try again.</p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

import { useMemo } from "react";

import { diffAgainstCurrent, diffHasChanges, type DiffRow, type InlinePart } from "@/lib/history-diff";
import { cn } from "@/lib/utils";

type HistoryDiffPreviewProps = {
  /** Open editor buffer (what the snapshot is compared against). */
  current: string;
  /** Selected history snapshot content. */
  backup: string;
};

function DiffParts({
  parts,
  changedClass,
}: {
  parts: InlinePart[];
  changedClass: string;
}) {
  return (
    <>
      {parts.map((part, index) => (
        <span key={index} className={part.changed ? changedClass : undefined}>
          {part.text || "\u00a0"}
        </span>
      ))}
    </>
  );
}

function rowClass(type: DiffRow["type"]): string {
  if (type === "add") return "bg-emerald-500/12";
  if (type === "remove") return "bg-destructive/10";
  return "";
}

function gutter(type: DiffRow["type"]): string {
  if (type === "add") return "+";
  if (type === "remove") return "−";
  return " ";
}

export function HistoryDiffPreview({ current, backup }: HistoryDiffPreviewProps) {
  const rows = useMemo(() => diffAgainstCurrent(current, backup), [current, backup]);
  const hasChanges = diffHasChanges(rows);

  if (!hasChanges) {
    return (
      <div>
        <p className="sticky top-0 z-10 border-b border-divider bg-panel px-4 py-2 text-xs text-dim">
          Identical to the current note
        </p>
        <pre className="whitespace-pre-wrap px-4 py-3 font-mono text-xs text-ink">{backup}</pre>
      </div>
    );
  }

  return (
    <div>
      <p className="sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-divider bg-panel px-4 py-2 text-xs text-dim">
        <span>Compared to current</span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2 rounded-sm bg-emerald-500/50" />
          this version
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2 rounded-sm bg-destructive/40" />
          current
        </span>
      </p>
      <pre className="min-w-0 font-mono text-xs leading-5 text-ink">
        {rows.map((row, index) => (
          <div
            key={index}
            className={cn("flex whitespace-pre-wrap px-3 py-px", rowClass(row.type))}
          >
            <span
              className={cn(
                "w-4 shrink-0 select-none text-center",
                row.type === "add" && "text-emerald-700 dark:text-emerald-400",
                row.type === "remove" && "text-destructive",
                row.type === "equal" && "text-transparent",
              )}
              aria-hidden
            >
              {gutter(row.type)}
            </span>
            <span className="min-w-0 flex-1">
              {row.type === "equal" ? (
                row.text || "\u00a0"
              ) : (
                <DiffParts
                  parts={row.parts}
                  changedClass={
                    row.type === "add"
                      ? "rounded-sm bg-emerald-500/25"
                      : "rounded-sm bg-destructive/25 line-through decoration-destructive/60"
                  }
                />
              )}
            </span>
          </div>
        ))}
      </pre>
    </div>
  );
}

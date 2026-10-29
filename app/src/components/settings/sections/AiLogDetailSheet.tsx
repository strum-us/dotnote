import { observer } from "mobx-react-lite";
import { getLlmProviderMeta } from "@shared/llm";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { aiLogStore } from "@/stores/ai-log-store";

function formatUsd(value: number): string {
  if (value >= 0.01) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(
      value,
    );
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  }).format(value);
}

export const AiLogDetailSheet = observer(function AiLogDetailSheet() {
  const log = aiLogStore.selectedLog;
  return (
    <Sheet open={aiLogStore.sheetOpen} onOpenChange={(open) => !open && aiLogStore.closeSheet()}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Log detail</SheetTitle>
          <SheetDescription>{log ? new Date(log.createdAt).toLocaleString() : ""}</SheetDescription>
        </SheetHeader>
        {log ? (
          <div className="mt-4 space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-md border border-divider bg-well p-3 text-xs">
              <div>
                <dt className="text-dim">Type</dt>
                <dd className="font-medium capitalize text-ink">{log.type}</dd>
              </div>
              <div>
                <dt className="text-dim">Status</dt>
                <dd className={log.status === "success" ? "text-emerald-600" : "text-danger"}>{log.status}</dd>
              </div>
              <div>
                <dt className="text-dim">Provider</dt>
                <dd className="text-ink">{getLlmProviderMeta(log.provider).name}</dd>
              </div>
              <div>
                <dt className="text-dim">Model</dt>
                <dd className="font-mono text-ink">{log.model}</dd>
              </div>
              <div>
                <dt className="text-dim">Input tokens</dt>
                <dd className="text-ink">{log.inputTokens.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-dim">Output tokens</dt>
                <dd className="text-ink">{log.outputTokens.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-dim">Input cost</dt>
                <dd className="font-mono text-ink">{formatUsd(log.inputCostUsd)}</dd>
              </div>
              <div>
                <dt className="text-dim">Output cost</dt>
                <dd className="font-mono text-ink">{formatUsd(log.outputCostUsd)}</dd>
              </div>
              <div>
                <dt className="text-dim">Total cost</dt>
                <dd className="font-mono font-semibold text-ink">{formatUsd(log.totalCostUsd)}</dd>
              </div>
              <div>
                <dt className="text-dim">Duration</dt>
                <dd className="text-ink">{log.durationMs.toLocaleString()} ms</dd>
              </div>
            </dl>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-dim">Input</p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-divider bg-well p-3 text-xs text-ink">
                {log.inputData || "—"}
              </pre>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-dim">Output</p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-divider bg-well p-3 text-xs text-ink">
                {log.outputData ?? log.errorMessage ?? "—"}
              </pre>
            </div>

            {log.errorMessage && log.outputData ? (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-dim">Error</p>
                <p className="rounded-md border border-danger/30 bg-danger/5 p-3 text-xs text-danger">{log.errorMessage}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
});

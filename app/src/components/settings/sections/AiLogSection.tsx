import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { observer } from "mobx-react-lite";
import type { AiLogPeriod } from "@shared/llm";
import { AiLogDetailSheet } from "@/components/settings/sections/AiLogDetailSheet";
import { SettingsSectionShell } from "@/components/settings/SettingsSectionShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { aiLogStore } from "@/stores/ai-log-store";

const PERIODS: { id: AiLogPeriod; label: string }[] = [
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "all", label: "All time" },
];

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

export const AiLogSection = observer(function AiLogSection() {
  useEffect(() => {
    void aiLogStore.refresh();
  }, []);

  const totalTokens = aiLogStore.summary.totalInputTokens + aiLogStore.summary.totalOutputTokens;

  return (
    <SettingsSectionShell
      title="Log"
      description="Recent AI text and image requests from this account. Costs use catalog pricing and estimated token counts."
      className="max-w-5xl pb-10"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="rounded-lg border border-divider bg-well p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-dim">Total cost</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">
            {formatUsd(aiLogStore.summary.totalCostUsd)}
          </p>
          <p className="mt-1 text-xs text-dim">
            {aiLogStore.summary.totalCount.toLocaleString()} requests · {totalTokens.toLocaleString()} tokens
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-divider bg-well p-0.5">
            {PERIODS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => aiLogStore.setPeriod(id)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs transition-colors",
                  aiLogStore.period === id ? "bg-raised font-medium text-ink" : "text-dim hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <Button variant="outline" size="icon" onClick={() => void aiLogStore.refresh()} disabled={aiLogStore.loading}>
            <RefreshCw className={cn("size-3.5", aiLogStore.loading && "animate-spin")} />
            <span className="sr-only">Refresh</span>
          </Button>
        </div>
      </div>

      {aiLogStore.error ? <p className="text-xs text-danger">{aiLogStore.error}</p> : null}

      <div className="overflow-hidden rounded-md border border-divider bg-well">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-divider bg-panel-header text-xs text-dim">
              <tr>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Model</th>
                <th className="px-3 py-2 font-medium">In / out tokens</th>
                <th className="px-3 py-2 font-medium">In / out cost</th>
                <th className="px-3 py-2 font-medium">Total</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {aiLogStore.logs.length === 0 && !aiLogStore.loading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-sm text-dim">
                    No logs yet. Run AI in a note to see usage here.
                  </td>
                </tr>
              ) : null}
              {aiLogStore.logs.map((log) => (
                <tr
                  key={log.id}
                  className="cursor-pointer transition-colors hover:bg-raised-hover"
                  onClick={() => aiLogStore.selectLog(log)}
                >
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-dim">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className="capitalize">
                      {log.type}
                    </Badge>
                  </td>
                  <td className="max-w-[140px] truncate px-3 py-2 font-mono text-xs" title={log.model}>
                    {log.model}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs tabular-nums">
                    {log.inputTokens.toLocaleString()} / {log.outputTokens.toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs tabular-nums">
                    {formatUsd(log.inputCostUsd)} / {formatUsd(log.outputCostUsd)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs tabular-nums">
                    {formatUsd(log.totalCostUsd)}
                  </td>
                  <td className="px-3 py-2">
                    <span className={log.status === "success" ? "text-emerald-600" : "text-danger"}>{log.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {aiLogStore.loading && aiLogStore.logs.length === 0 ? (
        <p className="text-center text-sm text-dim">Loading logs…</p>
      ) : null}

      {aiLogStore.hasMore ? (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => void aiLogStore.loadMore()} disabled={aiLogStore.loadingMore}>
            {aiLogStore.loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}

      <AiLogDetailSheet />
    </SettingsSectionShell>
  );
});

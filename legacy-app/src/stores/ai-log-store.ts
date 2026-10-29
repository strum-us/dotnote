import { makeAutoObservable, runInAction } from "mobx";
import type { AiLogItem, AiLogPeriod } from "@shared/llm";
import { llmApi } from "@/lib/api";

class AiLogStore {
  logs: AiLogItem[] = [];
  summary = {
    totalCostUsd: 0,
    totalCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  };
  period: AiLogPeriod = "all";
  nextCursor: string | null = null;

  loading = false;
  loadingMore = false;
  error: string | null = null;

  selectedLog: AiLogItem | null = null;
  sheetOpen = false;

  private inFlight: Promise<void> | null = null;

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  get hasMore(): boolean {
    return Boolean(this.nextCursor);
  }

  setPeriod(period: AiLogPeriod) {
    if (this.period === period) return;
    this.period = period;
    this.nextCursor = null;
    void this.refresh();
  }

  selectLog(log: AiLogItem) {
    this.selectedLog = log;
    this.sheetOpen = true;
  }

  closeSheet() {
    this.sheetOpen = false;
    this.selectedLog = null;
  }

  refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      runInAction(() => {
        this.loading = true;
        this.error = null;
      });
      try {
        const res = await llmApi.logs({ period: this.period, limit: 20 });
        runInAction(() => {
          this.logs = res.logs;
          this.summary = res.summary;
          this.nextCursor = res.nextCursor;
        });
      } catch (err) {
        runInAction(() => {
          this.error = err instanceof Error ? err.message : "Failed to load AI logs";
        });
      } finally {
        runInAction(() => {
          this.loading = false;
          this.inFlight = null;
        });
      }
    })();
    return this.inFlight;
  }

  async loadMore(): Promise<void> {
    if (!this.nextCursor || this.loadingMore) return;
    runInAction(() => {
      this.loadingMore = true;
      this.error = null;
    });
    try {
      const res = await llmApi.logs({
        period: this.period,
        limit: 20,
        cursor: this.nextCursor,
      });
      runInAction(() => {
        this.logs = [...this.logs, ...res.logs];
        this.nextCursor = res.nextCursor;
      });
    } catch (err) {
      runInAction(() => {
        this.error = err instanceof Error ? err.message : "Failed to load more logs";
      });
    } finally {
      runInAction(() => {
        this.loadingMore = false;
      });
    }
  }
}

export const aiLogStore = new AiLogStore();

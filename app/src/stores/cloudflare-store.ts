import { makeAutoObservable, runInAction } from "mobx";
import type { CloudflareStatusResponse, R2UsageResponse } from "@shared/types";
import { cloudflareApi } from "@/lib/api";

const USAGE_MAX_AGE_MS = 10 * 60 * 1000;

class CloudflareStore {
  status: CloudflareStatusResponse | null = null;
  usage: R2UsageResponse | null = null;
  statusError: string | null = null;
  usageError: string | null = null;
  statusLoading = false;
  usageLoading = false;
  reconnectError: string | null = null;
  checkError: string | null = null;
  checkMessage: string | null = null;
  connectionBusy = false;

  private statusInFlight: Promise<void> | null = null;
  private usageInFlight: Promise<void> | null = null;
  private usageFetchedAt = 0;

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  get usageStale(): boolean {
    if (!this.usage) return true;
    return Date.now() - this.usageFetchedAt > USAGE_MAX_AGE_MS;
  }

  refreshStatus(): Promise<void> {
    if (this.statusInFlight) return this.statusInFlight;
    this.statusInFlight = (async () => {
      runInAction(() => {
        this.statusLoading = true;
        this.statusError = null;
      });
      try {
        const status = await cloudflareApi.status();
        runInAction(() => {
          this.status = status;
        });
      } catch (err) {
        runInAction(() => {
          this.statusError = err instanceof Error ? err.message : "Failed to load status";
        });
      } finally {
        runInAction(() => {
          this.statusLoading = false;
          this.statusInFlight = null;
        });
      }
    })();
    return this.statusInFlight;
  }

  refreshUsage(force = false): Promise<void> {
    if (!force && this.usage && !this.usageStale) return Promise.resolve();
    if (this.usageInFlight) return this.usageInFlight;
    this.usageInFlight = (async () => {
      runInAction(() => {
        this.usageLoading = true;
        this.usageError = null;
      });
      try {
        const usage = await cloudflareApi.usage();
        runInAction(() => {
          this.usage = usage;
          this.usageFetchedAt = Date.now();
        });
      } catch (err) {
        runInAction(() => {
          this.usageError = err instanceof Error ? err.message : "Failed to calculate usage";
        });
      } finally {
        runInAction(() => {
          this.usageLoading = false;
          this.usageInFlight = null;
        });
      }
    })();
    return this.usageInFlight;
  }

  ensureLoaded(): void {
    void this.refreshStatus();
    void this.refreshUsage();
  }

  async reconnect(): Promise<void> {
    this.reconnectError = null;
    this.connectionBusy = true;
    try {
      const { url } = await cloudflareApi.reconnect();
      window.location.href = url;
    } catch (err) {
      runInAction(() => {
        this.reconnectError = err instanceof Error ? err.message : "Could not start reconnect";
        this.connectionBusy = false;
      });
    }
  }

  async checkConnection(): Promise<void> {
    this.checkError = null;
    this.checkMessage = null;
    this.connectionBusy = true;
    try {
      const result = await cloudflareApi.checkConnection();
      runInAction(() => {
        this.checkMessage = result.accountName
          ? `Cloudflare accepted the stored permission for ${result.accountName}.`
          : "Cloudflare accepted the stored permission.";
        this.connectionBusy = false;
      });
      await this.refreshStatus();
    } catch (err) {
      runInAction(() => {
        this.checkError = err instanceof Error ? err.message : "The stored permission was rejected";
        this.connectionBusy = false;
      });
    }
  }
}

export const cloudflareStore = new CloudflareStore();

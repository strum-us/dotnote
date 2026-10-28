import { makeAutoObservable, runInAction } from "mobx";
import type { CloudflareStatusResponse, R2UsageResponse } from "@shared/types";
import { ApiError, cloudflareApi } from "@/lib/api";
import { updateStore } from "@/stores/update-store";

const USAGE_MAX_AGE_MS = 10 * 60 * 1000;
/** Cloudflare deploys the Worker again to add or drop the token secret. Requests reach that version within seconds. */
const TOKEN_POLL_MS = 3000;
const TOKEN_POLL_TRIES = 20;

function errorText(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: string } | null;
    return body?.message ?? err.message;
  }
  return err instanceof Error ? err.message : fallback;
}

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
  tokenBusy = false;
  tokenError: string | null = null;
  /** Server code of the last rejection, e.g. `need_worker`: the form then asks for the Worker name and account. */
  tokenErrorCode: string | null = null;
  tokenMessage: string | null = null;

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

  /** Store an API token as this Worker's CF_API_TOKEN secret, then wait until this Dotnote runs with it. */
  async saveToken(input: { token: string; accountId?: string; workerName?: string }): Promise<boolean> {
    this.tokenBusy = true;
    this.tokenError = null;
    this.tokenErrorCode = null;
    this.tokenMessage = null;
    try {
      const saved = await cloudflareApi.saveToken(input);
      runInAction(() => {
        this.tokenMessage = `Cloudflare stored the token on ${saved.workerName}. Waiting for this Dotnote to pick it up…`;
      });
      const live = await this.waitForToken(true);
      runInAction(() => {
        this.tokenBusy = false;
        this.tokenMessage = live
          ? "This Dotnote can now update itself."
          : "Cloudflare has the token, but this Dotnote has not picked it up yet. Refresh in a minute.";
      });
      void updateStore.refresh(true);
      return true;
    } catch (err) {
      runInAction(() => {
        this.tokenBusy = false;
        this.tokenMessage = null;
        this.tokenErrorCode = err instanceof ApiError ? err.message : null;
        this.tokenError = errorText(err, "Could not store the token.");
      });
      return false;
    }
  }

  async removeToken(): Promise<void> {
    this.tokenBusy = true;
    this.tokenError = null;
    this.tokenErrorCode = null;
    this.tokenMessage = null;
    try {
      await cloudflareApi.removeToken();
      const gone = await this.waitForToken(false);
      runInAction(() => {
        this.tokenBusy = false;
        this.tokenMessage = gone ? "The token was removed from this Worker." : "Cloudflare is still removing the token.";
      });
      void updateStore.refresh(true);
    } catch (err) {
      runInAction(() => {
        this.tokenBusy = false;
        this.tokenError = errorText(err, "Could not remove the token.");
      });
    }
  }

  private async waitForToken(stored: boolean): Promise<boolean> {
    for (let attempt = 0; attempt < TOKEN_POLL_TRIES; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, TOKEN_POLL_MS));
      await this.refreshStatus();
      if ((this.status?.apiToken?.stored ?? false) === stored) return true;
    }
    return false;
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

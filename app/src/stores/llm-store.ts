import { makeAutoObservable, runInAction } from "mobx";
import { LLM_PROVIDER_META, getImageModelProvider, type LlmSettingsView, type UpdateLlmSettings } from "@shared/llm";
import { llmApi } from "@/lib/api";

class LlmStore {
  settings: LlmSettingsView | null = null;
  loading = false;
  saving = false;
  error: string | null = null;

  private inFlight: Promise<void> | null = null;

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  get configuredProviders() {
    const settings = this.settings;
    if (!settings) return [];
    return LLM_PROVIDER_META.filter((p) => settings.configuredProviders[p.id]);
  }

  /** True when the active provider has a key, so a request can run. */
  get ready(): boolean {
    return Boolean(this.settings?.configuredProviders[this.settings.activeProvider]);
  }

  /** True when the selected image model's provider has an API key. */
  get imageReady(): boolean {
    const settings = this.settings;
    if (!settings) return false;
    const provider = getImageModelProvider(settings.imageModel);
    return Boolean(settings.configuredProviders[provider]);
  }

  ensureLoaded(): Promise<void> {
    if (this.settings) return Promise.resolve();
    return this.refresh();
  }

  refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      runInAction(() => {
        this.loading = true;
        this.error = null;
      });
      try {
        const { settings } = await llmApi.settings();
        runInAction(() => {
          this.settings = settings;
        });
      } catch (err) {
        runInAction(() => {
          this.error = err instanceof Error ? err.message : "Failed to load AI settings";
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

  async update(patch: UpdateLlmSettings): Promise<void> {
    this.saving = true;
    try {
      const { settings } = await llmApi.update(patch);
      runInAction(() => {
        this.settings = settings;
      });
    } finally {
      runInAction(() => {
        this.saving = false;
      });
    }
  }
}

export const llmStore = new LlmStore();

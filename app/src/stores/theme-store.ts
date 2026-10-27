import {
  applyThemePreference,
  readThemePreference,
  type ResolvedTheme,
  type ThemePreference,
  writeThemePreference,
} from "@/lib/theme";
import { isClient } from "@/lib/is-client";
import { makeAutoObservable, runInAction } from "mobx";

class ThemeStore {
  preference: ThemePreference = "system";
  resolved: ResolvedTheme = "light";
  private media: MediaQueryList | null = null;
  private attached = false;

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  attach(): void {
    if (!isClient() || this.attached) return;
    this.attached = true;

    const preference = readThemePreference();
    runInAction(() => {
      this.preference = preference;
      this.resolved = applyThemePreference(preference);
    });

    this.media = window.matchMedia("(prefers-color-scheme: dark)");
    this.media.addEventListener("change", this.onSystemChange);
  }

  setPreference(preference: ThemePreference): void {
    this.preference = preference;
    writeThemePreference(preference);
    runInAction(() => {
      this.resolved = applyThemePreference(preference);
    });
  }

  private onSystemChange(): void {
    if (this.preference !== "system") return;
    runInAction(() => {
      this.resolved = applyThemePreference("system");
    });
  }
}

export const themeStore = new ThemeStore();

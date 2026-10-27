export const THEME_STORAGE_KEY = "dotnote-theme";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export function isThemePreference(value: string | null): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemePreference(stored)) return stored;
  } catch {
    /* ignore */
  }
  return "system";
}

export function writeThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    /* ignore */
  }
}

export function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? getSystemTheme() : preference;
}

export function applyResolvedTheme(resolved: ResolvedTheme): void {
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.style.colorScheme = resolved;
}

export function applyThemePreference(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference);
  applyResolvedTheme(resolved);
  return resolved;
}

/** Inline in index.html before CSS so the first paint matches stored preference. */
export const themeBootstrapScript = `(function(){var k=${JSON.stringify(THEME_STORAGE_KEY)};var d=document.documentElement;function sys(){return window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}function apply(mode){var r=mode==="system"?sys():mode;d.classList.toggle("dark",r==="dark");d.style.colorScheme=r;}try{var s=localStorage.getItem(k);var m=s==="light"||s==="dark"||s==="system"?s:"system";apply(m);}catch(e){apply("system");}})();`;

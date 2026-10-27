import { SETTINGS_SECTIONS, type SettingsSection } from "@/lib/settings-section";

const SETTINGS_PREFIX = "/settings";

export function parseSettingsPath(pathname: string): SettingsSection | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === SETTINGS_PREFIX) return "general";
  if (!path.startsWith(`${SETTINGS_PREFIX}/`)) return null;
  const segment = path.slice(SETTINGS_PREFIX.length + 1).split("/")[0];
  if (!segment) return "general";
  return SETTINGS_SECTIONS.includes(segment as SettingsSection) ? (segment as SettingsSection) : null;
}

export function settingsPath(section: SettingsSection): string {
  return section === "general" ? SETTINGS_PREFIX : `${SETTINGS_PREFIX}/${section}`;
}

export function pushSettingsRoute(section: SettingsSection | null, returnPath = "/"): void {
  const next = section ? settingsPath(section) : returnPath;
  if (window.location.pathname === next) return;
  window.history.pushState(null, "", next);
}

/** Open a settings section from anywhere; App picks the route up from popstate. */
export function openSettingsSection(section: SettingsSection): void {
  pushSettingsRoute(section);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function replaceSettingsRoute(section: SettingsSection | null, returnPath = "/"): void {
  const next = section ? settingsPath(section) : returnPath;
  if (window.location.pathname === next) return;
  window.history.replaceState(null, "", next);
}

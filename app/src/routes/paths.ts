export type SettingsSection = "general" | "ai" | "images" | "cloudflare" | "update" | "account";

export const AUTH_LOGIN_PATH = "/login";
export const AUTH_CREATE_PATH = "/createaccount";

export function isAuthCreatePath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === AUTH_CREATE_PATH;
}

const SETTINGS_PREFIX = "/settings";
const SHARE_PREFIX = "/s/";

export function settingsPath(section: SettingsSection): string {
  if (section === "general") return SETTINGS_PREFIX;
  return `${SETTINGS_PREFIX}/${section}`;
}

export function aiSettingsLogsPath(): string {
  return `${SETTINGS_PREFIX}/ai/logs`;
}

export function aiSettingsImagePath(): string {
  return `${SETTINGS_PREFIX}/ai/image`;
}

export function aiSettingsTextPath(): string {
  return `${SETTINGS_PREFIX}/ai`;
}

export function parsePublicShareToken(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (!path.startsWith(SHARE_PREFIX)) return null;
  const token = path.slice(SHARE_PREFIX.length).split("/")[0]?.trim();
  return token || null;
}

export function publicSharePath(token: string): string {
  return `${SHARE_PREFIX}${encodeURIComponent(token)}`;
}

export function isSettingsPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === SETTINGS_PREFIX || path.startsWith(`${SETTINGS_PREFIX}/`);
}

import { CLIENT_VERSION } from "@/lib/app-version";
import { updateStore } from "@/stores/update-store";

/** One-line update status for settings and Cloudflare summary cards. */
export function updateStatusSummary(): string {
  const check = updateStore.check;
  const current = updateStore.currentVersion ?? CLIENT_VERSION;
  if (!check) return `Running ${current}`;
  if (check.updateAvailable) return `Running ${current} · ${check.latestVersion} is available`;
  if (check.rolloutHeld) {
    return `Running ${current} · ${check.latestVersion} is rolling out and reaches this Dotnote later`;
  }
  if (check.latestVersion) return `Running ${current} · up to date`;
  return `Running ${current}`;
}

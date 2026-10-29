import { putSchedules, scriptSchedules } from "./cf-deploy";

/**
 * The Cron Trigger that runs schedule.ts. Same expression as the installer's
 * (installer/worker/steps.ts); wrangler deploys take it from wrangler.jsonc.
 */
export const UPDATE_CRON = "*/30 * * * *";

/** Add the update Cron Trigger next to any the script already has. */
export async function ensureUpdateSchedule(token: string, accountId: string, scriptName: string): Promise<void> {
  const crons = await scriptSchedules(token, accountId, scriptName);
  if (crons.includes(UPDATE_CRON)) return;
  await putSchedules(token, accountId, scriptName, [...crons, UPDATE_CRON]);
}

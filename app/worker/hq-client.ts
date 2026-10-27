import type { Env } from "./env";
import type { DirectoryProfile } from "./accounts";

/** Tell HQ this instance's owner and Cloudflare account. The password is not included. */
export async function publishProfile(env: Env, profile: DirectoryProfile): Promise<void> {
  const token = env.HQ_DIRECTORY_TOKEN?.trim();
  if (!token) return;
  const base = env.HQ_URL.replace(/\/$/, "");
  const request = new Request(`${base}/api/directory/profile`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(profile),
  });
  const res = env.HQ ? await env.HQ.fetch(request) : await fetch(request);
  if (!res.ok) {
    throw new Error(`directory_${res.status}`);
  }
}

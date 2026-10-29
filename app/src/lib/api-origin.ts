const SESSION_KEY = "dotnote.crossSiteSession";

/** Empty on a normal deployment. Set for the GitHub Pages demo, which cannot host the API. */
export function apiOrigin(): string {
  return (import.meta.env.VITE_API_ORIGIN ?? "").replace(/\/$/, "");
}

export function apiUrl(path: string): string {
  if (/^https?:/i.test(path)) return path;
  return `${apiOrigin()}${path}`;
}

function crossSiteSession(): string | null {
  if (!apiOrigin()) return null;
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function clearCrossSiteSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // private mode
  }
}

/**
 * Fetch an API path. On the Pages demo, attach the session the Worker issued
 * for this origin and remember a new one. Same-origin deploys keep using the cookie.
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const token = crossSiteSession();
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(apiUrl(path), {
    ...init,
    headers,
    credentials: "include",
  });
  const issued = res.headers.get("X-Dotnote-Session");
  if (issued && apiOrigin()) {
    try {
      sessionStorage.setItem(SESSION_KEY, issued);
    } catch {
      // private mode
    }
  }
  return res;
}

const objectUrls = new Map<string, Promise<string>>();

/** Turn an API asset URL into a blob URL when the page is not on the API origin. */
export function authedObjectUrl(href: string): Promise<string> {
  const absolute = apiUrl(href);
  const origin = apiOrigin();
  if (!origin || /^(data:|blob:)/i.test(absolute) || !absolute.startsWith(origin)) {
    return Promise.resolve(absolute);
  }
  const cached = objectUrls.get(absolute);
  if (cached) return cached;
  const pending = apiFetch(absolute).then(async (res) => {
    if (!res.ok) throw new Error("asset");
    return URL.createObjectURL(await res.blob());
  });
  objectUrls.set(absolute, pending);
  return pending;
}

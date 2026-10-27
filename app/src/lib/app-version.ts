/** Version of this page's code. vite.config.ts injects it from package.json; the Worker reports its own. */
export const CLIENT_VERSION: string = import.meta.env.VITE_APP_VERSION ?? "0.1.0-dev";

/** Unbuilt code (vitest, tooling) has no real version to compare. */
export const CLIENT_VERSION_KNOWN = !CLIENT_VERSION.endsWith("-dev");

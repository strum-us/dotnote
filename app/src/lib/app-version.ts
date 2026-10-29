/** Version of this page's code. next.config.ts injects it from package.json; the Worker reports its own. */
export const CLIENT_VERSION: string = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0-dev";

/** Unbuilt code (vitest, tooling) has no real version to compare. */
export const CLIENT_VERSION_KNOWN = !CLIENT_VERSION.endsWith("-dev");

export const UI_PREFERENCE_SCHEMA_VERSION = 1;

export const UI_PREFERENCE_BUILD_VERSION = CLIENT_VERSION;

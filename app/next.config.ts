import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const isWorker = process.env.DOTNOTE_CF === "1";

function readAppVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const appVersion = readAppVersion();

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
  ...(isWorker ? { images: { unoptimized: true } } : {}),
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      "react-router-dom": join(process.cwd(), "src/lib/next-router-compat.tsx"),
    };
    return config;
  },
};

export default nextConfig;

if (process.env.NODE_ENV !== "production") {
  const { initOpenNextCloudflareForDev } = require("@opennextjs/cloudflare");
  initOpenNextCloudflareForDev();
}

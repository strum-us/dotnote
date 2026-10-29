import { readFileSync } from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Same source as the Worker's BUILD_VERSION, so page and Worker agree on what "this version" is. */
const { version } = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8")) as { version: string };

const pagesBase = process.env.DOTNOTE_PAGES_BASE || "/";
const pagesOut = process.env.DOTNOTE_PAGES_OUT;
const apiOrigin = process.env.VITE_API_ORIGIN || "";

export default defineConfig({
  base: pagesBase,
  plugins: [react()],
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(version),
    "import.meta.env.VITE_API_ORIGIN": JSON.stringify(apiOrigin),
  },
  build: pagesOut ? { outDir: pagesOut, emptyOutDir: true } : undefined,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
  server: {
    port: 39220,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
});

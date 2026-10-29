import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { appRouter } from "@/routes/router";
import { themeStore } from "@/stores/theme-store";
import "./index.css";

themeStore.attach();

// The Pages demo has no API of its own. Land on the sample workspace.
if (import.meta.env.VITE_API_ORIGIN) {
  const root = import.meta.env.BASE_URL.replace(/\/$/, "");
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  if (path === root) {
    window.location.replace(`${root}/entry-sample`);
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={appRouter} />
  </StrictMode>,
);

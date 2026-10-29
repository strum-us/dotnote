import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { appRouter } from "@/routes/router";
import { themeStore } from "@/stores/theme-store";
import "./index.css";

themeStore.attach();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={appRouter} />
  </StrictMode>,
);

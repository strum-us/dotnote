import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { PublicSharePage } from "./components/PublicSharePage";
import { parsePublicSharePath } from "@/lib/share-route";
import { EntrySamplePage } from "@/entry-sample/EntrySamplePage";
import { parseEntrySamplePath } from "@/entry-sample/entry-sample-route";
import { themeStore } from "@/stores/theme-store";
import "./index.css";

themeStore.attach();

function Root() {
  const [pathname, setPathname] = useState(() =>
    typeof window !== "undefined" ? window.location.pathname : "/",
  );

  useEffect(() => {
    const sync = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const shareToken = parsePublicSharePath(pathname);
  if (shareToken) {
    return <PublicSharePage token={shareToken} />;
  }

  const entrySample = parseEntrySamplePath(pathname);
  if (entrySample) {
    return <EntrySamplePage hint={entrySample} />;
  }

  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

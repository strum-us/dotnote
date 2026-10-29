import { createBrowserRouter, Navigate, useLocation, useParams } from "react-router-dom";

import { AuthScreen } from "@/components/AuthScreen";
import { PublicSharePage } from "@/components/PublicSharePage";
import { AiImageSettings } from "@/components/settings/sections/AiImageSettings";
import { AiLogSection } from "@/components/settings/sections/AiLogSection";
import { AiSettings } from "@/components/settings/sections/AiSettings";
import { CloudflareSettings } from "@/components/settings/sections/CloudflareSettings";
import { ImageSettings } from "@/components/settings/sections/ImageSettings";
import { UpdateSettings } from "@/components/settings/sections/UpdateSettings";
import { EntrySamplePage } from "@/entry-sample/EntrySamplePage";
import { parseEntrySamplePath } from "@/entry-sample/entry-sample-route";
import { AiSettingsLayout } from "@/routes/AiSettingsLayout";
import { AppShell } from "@/routes/AppShell";
import { SettingsLayout } from "@/routes/SettingsLayout";
import { AccountSettingsPage, GeneralSettingsPage } from "@/routes/settings-pages";
import { WorkspaceRoute } from "@/routes/WorkspaceRoute";
import { AUTH_CREATE_PATH, AUTH_LOGIN_PATH } from "@/routes/paths";

function PublicShareRoute() {
  const { token } = useParams<{ token: string }>();
  if (!token) return null;
  return <PublicSharePage token={token} />;
}

function EntrySampleRoute() {
  const { pathname } = useLocation();
  const hint = parseEntrySamplePath(pathname);
  if (!hint) return null;
  return <EntrySamplePage hint={hint} />;
}

export const appRouter = createBrowserRouter([
  { path: "/s/:token", element: <PublicShareRoute /> },
  { path: "/entry-sample", element: <EntrySampleRoute /> },
  { path: "/entry-sample/*", element: <EntrySampleRoute /> },
  { path: AUTH_LOGIN_PATH, element: <AuthScreen /> },
  { path: AUTH_CREATE_PATH, element: <AuthScreen /> },
  {
    path: "/",
    element: <AppShell />,
    children: [
      { path: "settings/ai-image", element: <Navigate to="/settings/ai/image" replace /> },
      {
        path: "settings",
        element: <SettingsLayout />,
        children: [
          { index: true, element: <GeneralSettingsPage /> },
          {
            path: "ai",
            element: <AiSettingsLayout />,
            children: [
              { index: true, element: <AiSettings /> },
              { path: "image", element: <AiImageSettings /> },
              { path: "logs", element: <AiLogSection /> },
            ],
          },
          { path: "images", element: <ImageSettings /> },
          { path: "cloudflare", element: <CloudflareSettings /> },
          { path: "update", element: <UpdateSettings /> },
          { path: "account", element: <AccountSettingsPage /> },
        ],
      },
      { path: ":workspaceId/:noteId", element: <WorkspaceRoute /> },
      { path: ":workspaceId", element: <WorkspaceRoute /> },
      { index: true, element: <WorkspaceRoute /> },
    ],
  },
]);

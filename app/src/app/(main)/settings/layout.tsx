"use client";

import type { ReactNode } from "react";

import { SettingsLayout } from "@/routes/SettingsLayout";

export default function SettingsRootLayout({ children }: { children: ReactNode }) {
  return <SettingsLayout>{children}</SettingsLayout>;
}

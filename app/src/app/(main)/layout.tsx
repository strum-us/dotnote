"use client";

import type { ReactNode } from "react";

import { AppShell } from "@/routes/AppShell";
import { themeStore } from "@/stores/theme-store";

themeStore.attach();

export default function MainLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

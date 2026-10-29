"use client";

import type { ReactNode } from "react";

import { AiSettingsLayout } from "@/routes/AiSettingsLayout";

export default function SettingsAiLayout({ children }: { children: ReactNode }) {
  return <AiSettingsLayout>{children}</AiSettingsLayout>;
}

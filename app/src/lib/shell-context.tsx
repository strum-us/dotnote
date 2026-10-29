"use client";

import { createContext, useContext, type ReactNode } from "react";

export type ShellOutletContext = {
  openWorkspaceDialog: () => void;
};

const ShellContext = createContext<ShellOutletContext | null>(null);

export function ShellProvider({ value, children }: { value: ShellOutletContext; children: ReactNode }) {
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShellOutletContext(): ShellOutletContext {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("ShellProvider is missing");
  return ctx;
}

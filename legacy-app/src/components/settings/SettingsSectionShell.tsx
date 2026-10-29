import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function SettingsSectionShell({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mx-auto w-full max-w-2xl px-6 py-8", className)}>
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        {description ? <p className="mt-1 text-sm text-dim">{description}</p> : null}
      </header>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  );
}

export function SettingsField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">{label}</span>
      {children}
      {hint ? <span className="text-xs text-dim">{hint}</span> : null}
    </label>
  );
}

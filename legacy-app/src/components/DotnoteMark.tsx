import { cn } from "@/lib/utils";

/** App icon: a short line ending in the amber period. */
export function DotnoteMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 256 256" className={cn("size-4 shrink-0", className)} aria-hidden>
      <rect width="256" height="256" rx="56" fill="#191919" />
      <rect x="17" y="96" width="148" height="64" rx="32" fill="#f7f8fa" />
      <circle cx="207" cy="128" r="32" fill="#f2a93b" />
    </svg>
  );
}

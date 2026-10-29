"use client";

import { EntrySamplePage } from "@/entry-sample/EntrySamplePage";
import { parseEntrySamplePath } from "@/entry-sample/entry-sample-route";
import { usePathname } from "@/lib/next-router-compat";

export default function EntrySampleRoutePage() {
  const pathname = usePathname();
  const hint = parseEntrySamplePath(pathname);
  if (!hint) return null;
  return <EntrySamplePage hint={hint} />;
}

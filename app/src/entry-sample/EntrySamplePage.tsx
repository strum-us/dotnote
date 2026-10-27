import { useEffect, useState } from "react";

import { DotnoteMark } from "@/components/DotnoteMark";
import { notePath } from "@/lib/note-route";
import { entrySampleEnter, EntrySampleError } from "@/entry-sample/entry-sample-api";
import type { ParsedEntrySamplePath } from "@/entry-sample/entry-sample-route";

type Phase = "entering" | "failed";

const COPY: Record<string, string> = {
  not_configured: "This Dotnote does not offer a sample entry.",
  forbidden: "Sample entry is not available for this account.",
  request_failed: "Could not open the sample workspace. Try again.",
};

function failureMessage(code: string): string {
  return COPY[code] ?? COPY.request_failed!;
}

function redirectTarget(workspaceId: string, hint: ParsedEntrySamplePath): string {
  if (hint.noteId && hint.workspaceId === workspaceId) {
    return notePath(workspaceId, hint.noteId);
  }
  return notePath(workspaceId);
}

export function EntrySamplePage({ hint }: { hint: ParsedEntrySamplePath }) {
  const [phase, setPhase] = useState<Phase>("entering");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void entrySampleEnter()
      .then(({ workspaceId }) => {
        if (cancelled) return;
        window.location.replace(redirectTarget(workspaceId, hint));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const code = error instanceof EntrySampleError ? error.message : "request_failed";
        setMessage(failureMessage(code));
        setPhase("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [hint.noteId, hint.workspaceId]);

  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-sm border border-divider bg-well p-6 text-center">
        <DotnoteMark className="mx-auto size-10" />
        <h1 className="mt-3 text-lg font-semibold text-ink">Dotnote</h1>
        {phase === "entering" ? (
          <p className="mt-2 text-sm text-dim">Opening the sample workspace…</p>
        ) : (
          <p className="mt-2 text-sm text-dim">{message}</p>
        )}
      </div>
    </div>
  );
}

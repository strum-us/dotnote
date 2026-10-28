import { useEffect, useRef, type RefObject } from "react";
import type { BlockNoteEditor } from "@blocknote/core";
import { Square } from "lucide-react";
import { observer } from "mobx-react-lite";
import { blockElement } from "@/lib/ai-editor";
import { aiStore, type AiImageJob } from "@/stores/ai-store";

type Editor = BlockNoteEditor<any, any, any>;

export const AiImageJobLayer = observer(function AiImageJobLayer({
  editor,
  noteId,
  containerRef,
}: {
  editor: Editor;
  noteId: string;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const jobs = aiStore.jobsForNote(noteId);
  if (jobs.length === 0) return null;
  return (
    <>
      {jobs.map((job) => (
        <AiImageJobOverlay key={job.id} job={job} editor={editor} containerRef={containerRef} />
      ))}
    </>
  );
});

const AiImageJobOverlay = observer(function AiImageJobOverlay({
  job,
  editor,
  containerRef,
}: {
  job: AiImageJob;
  editor: Editor;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    let observed: HTMLElement | null = null;
    const sync = () => {
      raf = 0;
      const host = ref.current;
      const container = containerRef.current;
      const el = blockElement(editor, job.placeholderBlockId);
      if (el !== observed) {
        if (observed) resize.unobserve(observed);
        observed = el;
        if (el) resize.observe(el);
      }
      if (!host || !container || !el) {
        if (host) host.style.visibility = "hidden";
        return;
      }
      const block = el.getBoundingClientRect();
      const parent = container.getBoundingClientRect();
      host.style.visibility = "visible";
      host.style.transform = `translate(${block.left - parent.left}px, ${block.top - parent.top}px)`;
      host.style.width = `${block.width}px`;
      host.style.height = `${block.height}px`;
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(sync);
    };
    const resize = new ResizeObserver(queue);
    queue();
    const unsubscribe = editor.onChange(queue);
    window.addEventListener("resize", queue);
    window.addEventListener("scroll", queue, true);
    return () => {
      unsubscribe();
      resize.disconnect();
      window.removeEventListener("resize", queue);
      window.removeEventListener("scroll", queue, true);
      cancelAnimationFrame(raf);
    };
  }, [containerRef, editor, job.placeholderBlockId]);

  const label = job.estimated ? `Est. ${job.progress}%` : `${job.progress}%`;
  const status = job.phase === "saving" ? "Saving…" : job.phase === "error" ? job.error : "Generating image…";

  return (
    <div ref={ref} className="pointer-events-none absolute top-0 left-0 z-20" style={{ visibility: "hidden" }}>
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-md bg-well/80 px-4 text-center">
        {job.phase === "error" ? (
          <>
            <p className="max-w-sm text-sm text-danger">{status}</p>
            <div className="pointer-events-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => aiStore.retryJob(job.id)}
                className="rounded-md bg-accent-color px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-hover"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => aiStore.discardJob(job.id)}
                className="rounded-md border border-divider bg-well px-2.5 py-1 text-xs font-medium text-ink hover:bg-raised"
              >
                Discard
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="text-2xl font-semibold tabular-nums text-ink">{label}</span>
            <span className="text-xs text-dim">{status}</span>
            <div className="h-1 w-40 overflow-hidden rounded-full bg-raised">
              <div className="h-full bg-accent-color transition-[width] duration-150" style={{ width: `${job.progress}%` }} />
            </div>
            <button
              type="button"
              onClick={() => aiStore.cancelJob(job.id)}
              className="pointer-events-auto mt-1 flex items-center gap-1.5 rounded-full bg-ink px-3 py-1 text-xs font-medium text-well hover:opacity-80"
              title="Stop (Esc)"
            >
              <Square className="size-3 fill-current" />
              Stop
            </button>
          </>
        )}
      </div>
    </div>
  );
});

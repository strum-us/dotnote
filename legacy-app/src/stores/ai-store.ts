import type { BlockNoteEditor } from "@blocknote/core";
import { makeAutoObservable, runInAction } from "mobx";
import { pickImageNoteContext } from "@shared/image-prompt";
import { aiAnchorBlockId, aiRequestContext, type AiTarget } from "@/lib/ai-editor";
import { aiImageErrorMessage, base64ToBlob, generateAiImage } from "@/lib/ai-image-generate";
import { completeImagePlaceholder, insertImagePlaceholder, removeImagePlaceholder } from "@/lib/ai-image-insert";
import { loadSourceImage, type LoadedSourceImage } from "@/lib/ai-image-source";
import type { ImageOptimizationSettings } from "@/lib/image-settings";

export type AiMode =
  | { kind: "text" }
  | {
      kind: "image";
      source: LoadedSourceImage | null;
      sourceState: "idle" | "loading" | "ready" | "error";
      sourceError: string | null;
    };

export type AiImageJobPhase = "generating" | "saving" | "done" | "error";

export type AiImageJob = {
  id: string;
  noteId: string;
  placeholderBlockId: string;
  anchorBlockId: string;
  prompt: string;
  model: string;
  phase: AiImageJobPhase;
  progress: number;
  /** True while the number is a time estimate. Real providers do not report progress. */
  estimated: boolean;
  error?: string;
  startedAt: number;
};

type Editor = BlockNoteEditor<any, any, any>;

type JobRuntime = {
  controller: AbortController;
  timer: ReturnType<typeof setInterval> | null;
  editor: Editor;
  workspaceId: string;
  notePath: string;
  imageSettings: ImageOptimizationSettings;
  source: { mimeType: LoadedSourceImage["mimeType"]; dataBase64: string } | null;
  context?: string;
  tau: number;
};

const MODEL_TAU_MS: Record<string, number> = {
  "gemini-2.5-flash-image": 5_000,
  "gemini-3.1-flash-image": 8_000,
  "gpt-image-2.5-flare": 10_000,
  "gpt-image-2.5-sunburst": 14_000,
  "dall-e-3": 12_000,
  "dall-e-2": 8_000,
};

function estimatedProgress(elapsedMs: number, tau: number): number {
  return Math.min(92, Math.max(2, Math.round(92 * (1 - Math.exp(-elapsedMs / tau)))));
}

const jobRuntimes = new Map<string, JobRuntime>();

class AiStore {
  mode: AiMode = { kind: "text" };
  jobs = new Map<string, AiImageJob>();

  private sourceToken = 0;

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  jobsForNote(noteId: string): AiImageJob[] {
    return [...this.jobs.values()].filter((job) => job.noteId === noteId && job.phase !== "done");
  }

  enterImageMode(): void {
    this.revokeSource();
    this.mode = { kind: "image", source: null, sourceState: "idle", sourceError: null };
  }

  exitImageMode(): void {
    this.revokeSource();
    this.mode = { kind: "text" };
  }

  clearSource(): void {
    this.revokeSource();
    if (this.mode.kind !== "image") return;
    this.mode = { kind: "image", source: null, sourceState: "idle", sourceError: null };
  }

  /** Image mode with the given note image attached as the model input. */
  async attachSource(opts: Parameters<typeof loadSourceImage>[0]): Promise<void> {
    this.revokeSource();
    const token = this.sourceToken;
    this.mode = { kind: "image", source: null, sourceState: "loading", sourceError: null };
    try {
      const source = await loadSourceImage(opts);
      if (token !== this.sourceToken) {
        URL.revokeObjectURL(source.previewUrl);
        return;
      }
      runInAction(() => {
        this.mode = { kind: "image", source, sourceState: "ready", sourceError: null };
      });
    } catch (err) {
      if (token !== this.sourceToken) return;
      runInAction(() => {
        this.mode = {
          kind: "image",
          source: null,
          sourceState: "error",
          sourceError: err instanceof Error ? err.message : "Could not load this image.",
        };
      });
    }
  }

  startImageJob(opts: {
    editor: Editor;
    target: AiTarget;
    noteId: string;
    workspaceId: string;
    notePath: string;
    imageSettings: ImageOptimizationSettings;
    prompt: string;
    model: string;
  }): void {
    const source = this.mode.kind === "image" ? this.mode.source : null;
    const id = crypto.randomUUID();
    const placeholderBlockId = insertImagePlaceholder(opts.editor, opts.target, id);
    const ctx = aiRequestContext(opts.target);
    const context = pickImageNoteContext({
      selectionMarkdown: ctx.selection?.markdown,
      cursorBlock: ctx.cursorBlock,
      document: ctx.document,
    });
    const job: AiImageJob = {
      id,
      noteId: opts.noteId,
      placeholderBlockId,
      anchorBlockId: aiAnchorBlockId(opts.target),
      prompt: opts.prompt,
      model: opts.model,
      phase: "generating",
      progress: 2,
      estimated: true,
      startedAt: Date.now(),
    };
    const runtime: JobRuntime = {
      controller: new AbortController(),
      timer: null,
      editor: opts.editor,
      workspaceId: opts.workspaceId,
      notePath: opts.notePath,
      imageSettings: opts.imageSettings,
      source: source ? { mimeType: source.mimeType, dataBase64: source.dataBase64 } : null,
      context,
      tau: MODEL_TAU_MS[opts.model] ?? 6_000,
    };
    this.jobs.set(id, job);
    jobRuntimes.set(id, runtime);
    this.armTimer(id, runtime);
    void this.runJob(id);
  }

  cancelJob(id: string): void {
    const runtime = jobRuntimes.get(id);
    const job = this.jobs.get(id);
    if (!runtime || !job || job.phase === "done") return;
    runtime.controller.abort();
    this.stopTimer(runtime);
    removeImagePlaceholder(runtime.editor, job.placeholderBlockId);
    this.dropJob(id);
  }

  retryJob(id: string): void {
    const job = this.jobs.get(id);
    const runtime = jobRuntimes.get(id);
    if (!job || !runtime || job.phase !== "error") return;
    runtime.controller = new AbortController();
    this.patchJob(id, {
      phase: "generating",
      progress: 2,
      estimated: true,
      error: undefined,
      startedAt: Date.now(),
    });
    this.armTimer(id, runtime);
    void this.runJob(id);
  }

  discardJob(id: string): void {
    this.cancelJob(id);
  }

  cancelJobsForNote(noteId: string): void {
    for (const job of [...this.jobs.values()]) {
      if (job.noteId === noteId) this.cancelJob(job.id);
    }
  }

  private async runJob(id: string): Promise<void> {
    const runtime = jobRuntimes.get(id);
    const prompt = this.jobs.get(id)?.prompt;
    if (!runtime || !prompt) return;
    try {
      const result = await generateAiImage(
        {
          prompt,
          context: runtime.context,
          sourceImage: runtime.source ?? undefined,
        },
        runtime.controller.signal,
      );
      const job = this.jobs.get(id);
      if (!job || runtime.controller.signal.aborted) return;
      runInAction(() => {
        this.patchJob(id, { phase: "saving", progress: 95, estimated: false });
      });
      const blob = base64ToBlob(result.dataBase64, result.mimeType);
      if (!this.jobs.has(id) || runtime.controller.signal.aborted) return;
      await completeImagePlaceholder(runtime.editor, job.placeholderBlockId, job.anchorBlockId, blob, {
        workspaceId: runtime.workspaceId,
        notePath: runtime.notePath,
        settings: runtime.imageSettings,
      });
      if (!this.jobs.has(id) || runtime.controller.signal.aborted) return;
      runInAction(() => {
        if (!this.jobs.has(id)) return;
        this.patchJob(id, { phase: "done", progress: 100, estimated: false });
        this.stopTimer(runtime);
      });
      window.setTimeout(() => {
        runInAction(() => {
          if (this.jobs.get(id)?.phase === "done") this.dropJob(id);
        });
      }, 450);
    } catch (err) {
      if (runtime.controller.signal.aborted || !this.jobs.has(id)) return;
      runInAction(() => {
        if (!this.jobs.has(id)) return;
        this.stopTimer(runtime);
        this.patchJob(id, { phase: "error", estimated: false, error: aiImageErrorMessage(err) });
      });
    }
  }

  private armTimer(id: string, runtime: JobRuntime): void {
    this.stopTimer(runtime);
    runtime.timer = setInterval(() => {
      runInAction(() => {
        const job = this.jobs.get(id);
        if (!job || job.phase !== "generating") return;
        const next = estimatedProgress(Date.now() - job.startedAt, runtime.tau);
        if (next !== job.progress) this.patchJob(id, { progress: next });
      });
    }, 120);
  }

  private stopTimer(runtime: JobRuntime): void {
    if (runtime.timer) clearInterval(runtime.timer);
    runtime.timer = null;
  }

  private patchJob(id: string, patch: Partial<AiImageJob>): void {
    const job = this.jobs.get(id);
    if (!job) return;
    this.jobs.set(id, { ...job, ...patch });
  }

  private dropJob(id: string): void {
    const runtime = jobRuntimes.get(id);
    if (runtime) this.stopTimer(runtime);
    jobRuntimes.delete(id);
    this.jobs.delete(id);
  }

  private revokeSource(): void {
    this.sourceToken += 1;
    if (this.mode.kind === "image" && this.mode.source) URL.revokeObjectURL(this.mode.source.previewUrl);
  }
}

export const aiStore = new AiStore();

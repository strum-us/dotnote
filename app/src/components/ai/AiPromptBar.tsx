import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { BlockNoteEditor } from "@blocknote/core";
import {
  ArrowDownToLine,
  ArrowUp,
  Briefcase,
  Check,
  CircleHelp,
  Expand,
  FileText,
  ImageIcon,
  Languages,
  Lightbulb,
  ListChecks,
  ListTree,
  type LucideIcon,
  PenLine,
  RotateCcw,
  Settings,
  Shrink,
  Smile,
  Sparkles,
  SpellCheck,
  Square,
  Wand2,
  X,
} from "lucide-react";
import { observer } from "mobx-react-lite";
import { toast } from "sonner";
import { AI_BAR_PORTAL_ATTR, AiModelSelect } from "@/components/ai/AiModelSelect";
import {
  aiAnchorBottom,
  aiHasSelection,
  aiRequestContext,
  applyAiOutput,
  collapseSelection,
  showAiHighlight,
  type AiApplyMode,
  type AiTarget,
} from "@/lib/ai-editor";
import { aiErrorMessage, generateAi, type AiTurn } from "@/lib/ai-generate";
import { aiImageErrorMessage, base64ToBlob, generateAiImage } from "@/lib/ai-image-generate";
import { insertGeneratedImageAtTarget } from "@/lib/ai-image-insert";
import { looksLikeImageRequest, normalizeImagePrompt } from "@/lib/ai-image-intent";
import type { ImageOptimizationSettings } from "@/lib/image-settings";
import { findImageModel } from "@shared/llm";
import { cn } from "@/lib/utils";
import { translationInstruction, translationPromptLabel } from "@/lib/languages";
import { llmStore } from "@/stores/llm-store";
import { uiPreferenceStore } from "@/stores/ui-preference-store";

type Phase = "idle" | "streaming" | "generating-image" | "image-done" | "done" | "error";

const GENERATE_IMAGE_INSTRUCTION = "__generate_image__";

type Prompt = { label: string; icon: LucideIcon; instruction: string };

const SELECTION_PROMPTS: Prompt[] = [
  { label: "Improve writing", icon: Wand2, instruction: "Improve the writing: clearer and tighter, same meaning." },
  { label: "Fix spelling & grammar", icon: SpellCheck, instruction: "Fix spelling and grammar. Change nothing else." },
  { label: "Make shorter", icon: Shrink, instruction: "Make this shorter and keep the key points." },
  { label: "Make longer", icon: Expand, instruction: "Expand this with more detail, in the same voice." },
  { label: "Simplify language", icon: Sparkles, instruction: "Rewrite this in simpler, plainer language." },
  { label: "Make it professional", icon: Briefcase, instruction: "Rewrite this in a professional tone." },
  { label: "Make it casual", icon: Smile, instruction: "Rewrite this in a casual, friendly tone." },
  { label: "Summarize", icon: FileText, instruction: "Summarize this." },
  { label: "Explain this", icon: CircleHelp, instruction: "Explain what this means, briefly." },
];

function buildTranslationPrompts(primaryCode: string): Prompt[] {
  const codes = primaryCode === "en" ? ["en"] : [primaryCode, "en"];
  const seen = new Set<string>();
  const prompts: Prompt[] = [];
  for (const code of codes) {
    if (seen.has(code)) continue;
    seen.add(code);
    prompts.push({
      label: translationPromptLabel(code),
      icon: Languages,
      instruction: translationInstruction(code),
    });
  }
  return prompts;
}

const CURSOR_PROMPTS: Prompt[] = [
  {
    label: "Continue writing",
    icon: PenLine,
    instruction: "Continue writing from the cursor in the note's voice. One or two paragraphs.",
  },
  { label: "Summarize this note", icon: FileText, instruction: "Write a short summary of the whole note." },
  { label: "Find action items", icon: ListChecks, instruction: "List the action items in this note as a checklist." },
  { label: "Brainstorm ideas", icon: Lightbulb, instruction: "Brainstorm ideas that build on this note, as a bullet list." },
  { label: "Write an outline", icon: ListTree, instruction: "Write an outline for this note's topic as nested bullets." },
  {
    label: "Generate image",
    icon: ImageIcon,
    instruction: GENERATE_IMAGE_INSTRUCTION,
  },
];

type MenuItem = { id: string; label: string; icon: LucideIcon; run: () => void; danger?: boolean };

export const AiPromptBar = observer(function AiPromptBar({
  editor,
  target,
  containerRef,
  workspaceId,
  notePath,
  imageSettings,
  onClose,
  onOpenSettings,
  onOpenImageSettings,
}: {
  editor: BlockNoteEditor;
  target: AiTarget;
  containerRef: RefObject<HTMLDivElement | null>;
  workspaceId: string;
  notePath: string;
  imageSettings: ImageOptimizationSettings;
  /** `restore` puts the original selection back (dismiss); false leaves the cursor where it is. */
  onClose: (restore: boolean) => void;
  onOpenSettings: () => void;
  onOpenImageSettings: () => void;
}) {
  const [value, setValue] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [output, setOutput] = useState("");
  const [turns, setTurns] = useState<AiTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [top, setTop] = useState<number | null>(null);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const outputTextRef = useRef("");
  const imageBlobRef = useRef<Blob | null>(null);
  const lastImagePromptRef = useRef<string | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageCaption, setImageCaption] = useState<string | null>(null);

  const hasSelection = aiHasSelection(target);
  const translateTarget = uiPreferenceStore.aiTranslateTarget;

  const selectionPrompts = useMemo(() => {
    const base = SELECTION_PROMPTS;
    const translateIndex = base.findIndex((p) => p.label === "Summarize");
    const head = translateIndex >= 0 ? base.slice(0, translateIndex) : base;
    const tail = translateIndex >= 0 ? base.slice(translateIndex) : [];
    return [...head, ...buildTranslationPrompts(translateTarget), ...tail];
  }, [translateTarget]);

  useEffect(() => {
    void llmStore.ensureLoaded();
  }, []);

  useEffect(() => showAiHighlight(editor, target), [editor, target]);

  // Take focus first: once the editor is blurred, collapsing its selection (which
  // hides the formatting toolbar) no longer pulls the DOM focus back into it.
  useLayoutEffect(() => {
    inputRef.current?.focus();
    collapseSelection(editor, target);
  }, [editor, target]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);

  const clearImagePreview = useCallback(() => {
    setImagePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    imageBlobRef.current = null;
    setImageCaption(null);
  }, []);

  const reposition = useCallback(() => {
    const container = containerRef.current;
    const bottom = aiAnchorBottom(editor, target);
    if (!container || bottom === null) return;
    setTop(bottom - container.getBoundingClientRect().top + 6);
  }, [containerRef, editor, target]);

  useLayoutEffect(() => {
    reposition();
    const unsubscribe = editor.onChange(reposition);
    window.addEventListener("resize", reposition);
    return () => {
      unsubscribe();
      window.removeEventListener("resize", reposition);
    };
  }, [editor, reposition]);

  useEffect(() => {
    if (top === null) return;
    wrapperRef.current?.scrollIntoView({ block: "nearest" });
  }, [top, phase]);

  useEffect(() => {
    const el = outputRef.current;
    if (el && phase === "streaming") el.scrollTop = el.scrollHeight;
  }, [output, phase]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const node = event.target as Element | null;
      if (!node || wrapperRef.current?.contains(node) || node.closest(`[${AI_BAR_PORTAL_ATTR}]`)) return;
      // Keep a response around until it is accepted or discarded on purpose.
      if (phaseRef.current === "idle" || phaseRef.current === "error") onClose(false);
      if (phaseRef.current === "image-done") onClose(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [onClose]);

  const run = useCallback(
    async (instruction: string, history: AiTurn[]) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setValue("");
      setError(null);
      setOutput("");
      outputTextRef.current = "";
      setPhase("streaming");
      setActiveIndex(0);
      try {
        const text = await generateAi(
          { ...aiRequestContext(target), turns: [...history, { instruction }] },
          (soFar) => {
            outputTextRef.current = soFar;
            setOutput(soFar);
          },
          controller.signal,
        );
        if (abortRef.current !== controller) return;
        setTurns([...history, { instruction, output: text }]);
        setPhase(text.trim() ? "done" : "error");
        if (!text.trim()) setError("The model returned an empty response.");
      } catch (err) {
        if (abortRef.current !== controller) return;
        if (controller.signal.aborted) {
          const partial = outputTextRef.current;
          setTurns([...history, { instruction, output: partial }]);
          setPhase(partial.trim() ? "done" : "idle");
          return;
        }
        setTurns(history);
        setError(aiErrorMessage(err));
        setPhase("error");
      }
    },
    [target],
  );

  const runImage = useCallback(
    async (prompt: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setValue("");
      setError(null);
      setOutput("");
      clearImagePreview();
      setPhase("generating-image");
      setActiveIndex(0);
      lastImagePromptRef.current = prompt;
      try {
        const ctx = aiRequestContext(target);
        const context =
          ctx.selection?.markdown ?? ctx.cursorBlock ?? ctx.document?.slice(0, 80_000);
        const result = await generateAiImage({ prompt, context }, controller.signal);
        if (abortRef.current !== controller) return;
        const blob = base64ToBlob(result.dataBase64, result.mimeType);
        imageBlobRef.current = blob;
        setImagePreviewUrl(URL.createObjectURL(blob));
        setImageCaption(result.caption ?? null);
        setPhase("image-done");
      } catch (err) {
        if (abortRef.current !== controller) return;
        if (controller.signal.aborted) {
          setPhase("idle");
          return;
        }
        setError(aiImageErrorMessage(err));
        setPhase("error");
      }
    },
    [clearImagePreview, target],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const insertImage = useCallback(async () => {
    const blob = imageBlobRef.current;
    if (!blob) return;
    try {
      await insertGeneratedImageAtTarget(editor, target, workspaceId, notePath, blob, imageSettings);
      onClose(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not insert the image");
    }
  }, [editor, imageSettings, notePath, onClose, target, workspaceId]);

  const apply = useCallback(
    async (mode: AiApplyMode) => {
      const text = turns[turns.length - 1]?.output ?? "";
      if (!text.trim()) return;
      try {
        const exact = await applyAiOutput(editor, target, text, mode);
        if (!exact) toast.message("The text changed while AI was writing, so the result went below it.");
        onClose(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not insert the AI result");
      }
    },
    [editor, onClose, target, turns],
  );

  const retry = useCallback(() => {
    const last = turns[turns.length - 1];
    if (last) void run(last.instruction, turns.slice(0, -1));
  }, [run, turns]);

  const lastInstructionRef = useRef<string | null>(null);

  const submit = useCallback(
    (instruction: string) => {
      const trimmed = instruction.trim();
      const fromInput = value.trim();
      const wantsImage =
        instruction === GENERATE_IMAGE_INSTRUCTION ||
        looksLikeImageRequest(trimmed) ||
        (phase === "image-done" && Boolean(fromInput || instruction === GENERATE_IMAGE_INSTRUCTION));
      if (wantsImage) {
        const prompt =
          instruction === GENERATE_IMAGE_INSTRUCTION
            ? fromInput || "An illustration that fits this note"
            : normalizeImagePrompt(trimmed || fromInput);
        if (!prompt) return;
        void runImage(prompt);
        return;
      }
      if (!trimmed) return;
      lastInstructionRef.current = trimmed;
      void run(trimmed, phase === "done" ? turns : []);
    },
    [phase, run, runImage, turns, value],
  );

  const menu: MenuItem[] = useMemo(() => {
    if (phase === "streaming" || phase === "generating-image") return [];
    if (phase === "image-done") {
      return [
        { id: "insert", label: "Insert", icon: Check, run: () => void insertImage() },
        {
          id: "retry",
          label: "Try again",
          icon: RotateCcw,
          run: () => {
            const prompt = lastImagePromptRef.current;
            if (prompt) void runImage(prompt);
          },
        },
        {
          id: "discard",
          label: "Discard",
          icon: X,
          run: () => {
            clearImagePreview();
            onClose(true);
          },
          danger: true,
        },
      ];
    }
    if (phase === "done") {
      const items: MenuItem[] = [
        {
          id: "replace",
          label: hasSelection ? "Replace selection" : "Insert",
          icon: Check,
          run: () => void apply("replace"),
        },
      ];
      if (hasSelection) items.push({ id: "insert", label: "Insert below", icon: ArrowDownToLine, run: () => void apply("insert") });
      items.push(
        { id: "retry", label: "Try again", icon: RotateCcw, run: retry },
        { id: "discard", label: "Discard", icon: X, run: () => onClose(true), danger: true },
      );
      return items;
    }
    if (phase === "error") {
      const items: MenuItem[] = [];
      if (lastImagePromptRef.current) {
        items.push({
          id: "retry-image",
          label: "Try again",
          icon: RotateCcw,
          run: () => void runImage(lastImagePromptRef.current!),
        });
      } else if (lastInstructionRef.current) {
        items.push({
          id: "retry",
          label: "Try again",
          icon: RotateCcw,
          run: () => void run(lastInstructionRef.current!, turns),
        });
      }
      if (!llmStore.imageReady && lastImagePromptRef.current) {
        items.push({ id: "image-settings", label: "Open AI Image settings", icon: Settings, run: onOpenImageSettings });
      } else if (!llmStore.ready) {
        items.push({ id: "settings", label: "Open AI settings", icon: Settings, run: onOpenSettings });
      }
      items.push({ id: "discard", label: "Close", icon: X, run: () => onClose(true) });
      return items;
    }
    const query = value.trim().toLowerCase();
    const prompts = hasSelection ? selectionPrompts : CURSOR_PROMPTS;
    return prompts
      .filter((p) => !query || p.label.toLowerCase().includes(query))
      .map((p) => ({ id: p.label, label: p.label, icon: p.icon, run: () => submit(p.instruction) }));
  }, [
    apply,
    clearImagePreview,
    hasSelection,
    insertImage,
    onClose,
    onOpenImageSettings,
    onOpenSettings,
    phase,
    retry,
    run,
    runImage,
    selectionPrompts,
    submit,
    turns,
    value,
  ]);

  // Each phase brings a new menu; start on its first item unless the user is typing.
  useEffect(() => {
    setActiveIndex(phase === "streaming" || phase === "generating-image" || inputRef.current?.value.trim() ? -1 : 0);
  }, [phase]);

  useEffect(() => {
    setActiveIndex((index) => (index < menu.length ? index : -1));
  }, [menu.length]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (phase === "streaming" || phase === "generating-image") stop();
      else onClose(true);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (menu.length === 0) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => (index < 0 ? (step > 0 ? 0 : menu.length - 1) : (index + step + menu.length) % menu.length));
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (phase === "streaming" || phase === "generating-image") return;
      // A highlighted menu item wins; typing clears the highlight, so Enter sends the text.
      if (activeIndex >= 0 && menu[activeIndex]) menu[activeIndex].run();
      else submit(value);
    }
  };

  const placeholder =
    phase === "image-done"
      ? "Describe changes for a new image…"
      : phase === "done"
        ? "Tell AI what to change next…"
        : hasSelection
          ? "Edit with AI"
          : "Ask AI to write anything…";
  const showOutput =
    phase === "streaming" ||
    phase === "generating-image" ||
    phase === "image-done" ||
    phase === "done" ||
    (phase === "error" && (output || imagePreviewUrl));
  const imageModelLabel = findImageModel(llmStore.settings?.imageModel ?? "")?.label ?? "Gemini image";

  return (
    <div
      ref={wrapperRef}
      className="absolute inset-x-6 z-30 flex flex-col gap-1.5"
      // Opacity, not visibility, so the input can take focus before the first measure.
      style={{ top: top ?? 0, opacity: top === null ? 0 : 1 }}
    >
      <div className="overflow-hidden rounded-xl border border-divider bg-well shadow-[0_6px_24px_rgba(15,23,42,0.12)] dark:shadow-[0_6px_24px_rgba(0,0,0,0.5)]">
        {showOutput ? (
          <div
            ref={outputRef}
            className="max-h-[45vh] overflow-y-auto border-b border-divider px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap text-ink"
          >
            {phase === "image-done" && imagePreviewUrl ? (
              <div className="flex flex-col gap-2">
                <img src={imagePreviewUrl} alt="Generated preview" className="max-h-[40vh] w-full rounded-lg object-contain" />
                {imageCaption ? <p className="text-sm text-dim">{imageCaption}</p> : null}
              </div>
            ) : phase === "generating-image" ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-dim">
                <ImageIcon className="size-3.5 animate-pulse text-accent-color" />
                Generating image with {imageModelLabel}…
              </span>
            ) : (
              output || (
                <span className="inline-flex items-center gap-1.5 text-sm text-dim">
                  <Sparkles className="size-3.5 animate-pulse text-accent-color" />
                  AI is writing…
                </span>
              )
            )}
          </div>
        ) : null}
        <div className="flex items-center gap-2 py-2 pr-2 pl-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-divider bg-panel">
            {phase === "generating-image" || phase === "image-done" ? (
              <ImageIcon className={cn("size-4 text-accent-color", phase === "generating-image" && "animate-pulse")} />
            ) : (
              <Sparkles className={cn("size-4 text-accent-color", phase === "streaming" && "animate-pulse")} />
            )}
          </div>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setActiveIndex(e.target.value.trim() ? -1 : 0);
            }}
            onKeyDown={onKeyDown}
            placeholder={
              phase === "streaming"
                ? "AI is writing…"
                : phase === "generating-image"
                  ? "Generating image…"
                  : placeholder
            }
            // Read-only rather than disabled, so it keeps focus and Esc can stop the run.
            readOnly={phase === "streaming" || phase === "generating-image"}
            className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-dim read-only:cursor-default"
            aria-label="Instruction for AI"
          />
          {phase === "generating-image" || phase === "image-done" ? (
            <span className="max-w-[9rem] truncate px-1 text-xs text-dim" title={imageModelLabel}>
              {imageModelLabel}
            </span>
          ) : (
            <AiModelSelect
              disabled={phase === "streaming"}
              onOpenSettings={onOpenSettings}
              onAfterClose={() => inputRef.current?.focus()}
            />
          )}
          {phase === "streaming" || phase === "generating-image" ? (
            <button
              type="button"
              onClick={stop}
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-well hover:opacity-80"
              title="Stop (Esc)"
            >
              <Square className="size-3 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => submit(value)}
              disabled={!value.trim() && phase !== "image-done"}
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-color text-white hover:bg-accent-hover disabled:bg-raised disabled:text-dim"
              title="Send (Enter)"
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </div>
        {error ? <p className="border-t border-divider px-4 py-2 text-xs text-danger">{error}</p> : null}
      </div>

      {menu.length > 0 ? (
        <div className="w-64 overflow-hidden rounded-lg border border-divider bg-well py-1 shadow-[0_6px_24px_rgba(15,23,42,0.12)] dark:shadow-[0_6px_24px_rgba(0,0,0,0.5)]">
          {menu.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onMouseEnter={() => setActiveIndex(index)}
                onClick={item.run}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                  index === activeIndex ? "bg-raised" : "",
                  item.danger ? "text-danger" : "text-ink",
                )}
              >
                <Icon className={cn("size-4 shrink-0", item.danger ? "text-danger" : "text-accent-color")} />
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
});

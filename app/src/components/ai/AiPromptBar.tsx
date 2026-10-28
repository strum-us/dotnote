import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { BlockNoteEditor } from "@blocknote/core";
import {
  ArrowDownToLine,
  ArrowUp,
  Briefcase,
  Check,
  ChevronRight,
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
import { AI_BAR_PORTAL_ATTR } from "@/components/ai/AiModelSelect";
import { AiImageModelSelect } from "@/components/ai/AiImageModelSelect";
import { AiModelSelect } from "@/components/ai/AiModelSelect";
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
import { findImageModel } from "@shared/llm";
import { cn } from "@/lib/utils";
import {
  SUPPORTED_LANGUAGES,
  getLanguageName,
  translationInstruction,
} from "@/lib/languages";
import { llmStore } from "@/stores/llm-store";
import { aiStore } from "@/stores/ai-store";
import { uiPreferenceStore } from "@/stores/ui-preference-store";
import type { ImageOptimizationSettings } from "@/lib/image-settings";

type Phase = "idle" | "streaming" | "done" | "error";

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
  { label: "Translate to", icon: Languages, instruction: "" },
  { label: "Summarize", icon: FileText, instruction: "Summarize this." },
  { label: "Explain this", icon: CircleHelp, instruction: "Explain what this means, briefly." },
];

const TRANSLATE_MENU_LABEL = "Translate to";

function translateMenuMatchesQuery(query: string): boolean {
  if (!query) return true;
  if (TRANSLATE_MENU_LABEL.toLowerCase().includes(query)) return true;
  return SUPPORTED_LANGUAGES.some(
    (lang) =>
      lang.name.toLowerCase().includes(query) ||
      lang.nativeName.toLowerCase().includes(query) ||
      lang.code.toLowerCase().includes(query),
  );
}

function filterLanguagesForQuery(query: string) {
  if (!query) return SUPPORTED_LANGUAGES;
  return SUPPORTED_LANGUAGES.filter(
    (lang) =>
      lang.name.toLowerCase().includes(query) ||
      lang.nativeName.toLowerCase().includes(query) ||
      lang.code.toLowerCase().includes(query),
  );
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

type MenuItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  run: () => void;
  danger?: boolean;
  hasSubmenu?: boolean;
  badge?: string;
};

export const AiPromptBar = observer(function AiPromptBar({
  editor,
  target,
  containerRef,
  workspaceId,
  noteId,
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
  noteId: string;
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
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const [subActiveIndex, setSubActiveIndex] = useState(0);
  const [top, setTop] = useState<number | null>(null);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const outputTextRef = useRef("");

  const hasSelection = aiHasSelection(target);
  const mode = aiStore.mode;
  const imageMode = mode.kind === "image";
  const imageSource = mode.kind === "image" ? mode.source : null;
  const translateTarget = uiPreferenceStore.aiTranslateTarget;
  const translateTargetName = getLanguageName(translateTarget);

  const languageSubmenu = useMemo(
    () => filterLanguagesForQuery(value.trim().toLowerCase()),
    [value],
  );

  useEffect(() => {
    void llmStore.ensureLoaded();
  }, []);

  useLayoutEffect(() => {
    if (target.kind !== "image") return;
    void aiStore.attachSource({
      blockId: target.blockId,
      url: target.url,
      name: target.name,
      workspaceId,
      notePath,
    });
  }, [notePath, target, workspaceId]);

  useEffect(() => () => aiStore.exitImageMode(), []);

  useEffect(() => showAiHighlight(editor, target), [editor, target]);

  // Take focus first: once the editor is blurred, collapsing its selection (which
  // hides the formatting toolbar) no longer pulls the DOM focus back into it.
  useLayoutEffect(() => {
    inputRef.current?.focus();
    collapseSelection(editor, target);
  }, [editor, target]);

  useEffect(() => () => abortRef.current?.abort(), []);

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

  const stop = useCallback(() => abortRef.current?.abort(), []);

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
      if (aiStore.mode.kind === "image") {
        const prompt = trimmed || value.trim();
        if (!prompt) return;
        if (aiStore.mode.sourceState === "loading") return;
        if (aiStore.mode.sourceState === "error") {
          setError(aiStore.mode.sourceError ?? "Could not load this image.");
          setPhase("error");
          return;
        }
        if (!llmStore.imageReady) {
          setError("Add an API key for the image model in Settings → AI Image.");
          setPhase("error");
          return;
        }
        const modelId = llmStore.settings?.imageModel ?? "";
        if (aiStore.mode.source && !findImageModel(modelId)?.supportsImageInput) {
          setError("This image model can't edit an existing image. Switch to a Gemini image model.");
          setPhase("error");
          return;
        }
        try {
          aiStore.startImageJob({
            editor,
            target,
            noteId,
            workspaceId,
            notePath,
            imageSettings,
            prompt,
            model: modelId,
          });
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not start image generation.");
          setPhase("error");
          return;
        }
        onClose(false);
        return;
      }
      if (!trimmed) return;
      lastInstructionRef.current = trimmed;
      void run(trimmed, phase === "done" ? turns : []);
    },
    [editor, imageSettings, noteId, notePath, onClose, phase, run, target, turns, value, workspaceId],
  );

  const selectLanguageAndRun = useCallback(
    (code: string) => {
      uiPreferenceStore.setAiTranslateTarget(code);
      setSubmenuOpen(false);
      submit(translationInstruction(code));
    },
    [submit],
  );

  const openLanguageSubmenu = useCallback(() => {
    setSubmenuOpen(true);
    const idx = languageSubmenu.findIndex((lang) => lang.code === translateTarget);
    setSubActiveIndex(idx >= 0 ? idx : 0);
  }, [languageSubmenu, translateTarget]);

  const menu: MenuItem[] = useMemo(() => {
    if (phase === "streaming") return [];
    if (aiStore.mode.kind === "image" && phase !== "error") return [];
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
      if (aiStore.mode.kind === "image") {
        if (!llmStore.imageReady) {
          items.push({ id: "image-settings", label: "Open AI Image settings", icon: Settings, run: onOpenImageSettings });
        }
      } else if (lastInstructionRef.current) {
        items.push({
          id: "retry",
          label: "Try again",
          icon: RotateCcw,
          run: () => void run(lastInstructionRef.current!, turns),
        });
        if (!llmStore.ready) {
          items.push({ id: "settings", label: "Open AI settings", icon: Settings, run: onOpenSettings });
        }
      }
      items.push({ id: "discard", label: "Close", icon: X, run: () => onClose(true) });
      return items;
    }
    const query = value.trim().toLowerCase();
    if (hasSelection) {
      return SELECTION_PROMPTS.filter((p) => {
        if (!query) return true;
        if (p.label === TRANSLATE_MENU_LABEL) return translateMenuMatchesQuery(query);
        return p.label.toLowerCase().includes(query);
      }).map((p) => {
        if (p.label === TRANSLATE_MENU_LABEL) {
          return {
            id: "translate",
            label: TRANSLATE_MENU_LABEL,
            icon: Languages,
            hasSubmenu: true,
            badge: translateTargetName,
            run: () => selectLanguageAndRun(translateTarget),
          };
        }
        return { id: p.label, label: p.label, icon: p.icon, run: () => submit(p.instruction) };
      });
    }
    return CURSOR_PROMPTS.filter((p) => !query || p.label.toLowerCase().includes(query)).map((p) => ({
      id: p.label,
      label: p.label,
      icon: p.icon,
      run: () => {
        if (p.instruction === GENERATE_IMAGE_INSTRUCTION) {
          aiStore.enterImageMode();
          setValue("");
          setActiveIndex(-1);
          return;
        }
        submit(p.instruction);
      },
    }));
  }, [
    apply,
    hasSelection,
    onClose,
    onOpenImageSettings,
    onOpenSettings,
    phase,
    retry,
    run,
    selectLanguageAndRun,
    submit,
    translateTarget,
    translateTargetName,
    turns,
    value,
    imageMode,
    llmStore.imageReady,
    llmStore.ready,
  ]);

  // Each phase brings a new menu; start on its first item unless the user is typing.
  useEffect(() => {
    setActiveIndex(phase === "streaming" || inputRef.current?.value.trim() ? -1 : 0);
  }, [phase]);

  useEffect(() => {
    setActiveIndex((index) => (index < menu.length ? index : -1));
  }, [menu.length]);

  useEffect(() => {
    if (phase !== "idle") setSubmenuOpen(false);
  }, [phase]);

  useEffect(() => {
    setSubActiveIndex((index) => (index < languageSubmenu.length ? index : 0));
  }, [languageSubmenu.length]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (submenuOpen) {
        setSubmenuOpen(false);
        return;
      }
      if (phase === "streaming") stop();
      else if (imageMode && target.kind !== "image" && phase === "idle") aiStore.exitImageMode();
      else onClose(true);
      return;
    }
    if (submenuOpen && languageSubmenu.length > 0) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setSubmenuOpen(false);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setSubActiveIndex(
          (index) => (index + step + languageSubmenu.length) % languageSubmenu.length,
        );
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        const lang = languageSubmenu[subActiveIndex];
        if (lang) selectLanguageAndRun(lang.code);
        return;
      }
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (menu.length === 0) return;
      event.preventDefault();
      setSubmenuOpen(false);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => (index < 0 ? (step > 0 ? 0 : menu.length - 1) : (index + step + menu.length) % menu.length));
      return;
    }
    if (event.key === "ArrowRight") {
      const item = activeIndex >= 0 ? menu[activeIndex] : null;
      if (item?.hasSubmenu && languageSubmenu.length > 0) {
        event.preventDefault();
        openLanguageSubmenu();
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (phase === "streaming") return;
      const item = activeIndex >= 0 ? menu[activeIndex] : null;
      if (item?.hasSubmenu) {
        if (submenuOpen && languageSubmenu[subActiveIndex]) {
          selectLanguageAndRun(languageSubmenu[subActiveIndex].code);
        } else {
          item.run();
        }
        return;
      }
      // A highlighted menu item wins; typing clears the highlight, so Enter sends the text.
      if (item) item.run();
      else submit(value);
    }
  };

  const placeholder = imageMode
    ? imageSource
      ? "Describe how to change this image…"
      : "Describe an image…"
    : phase === "done"
      ? "Tell AI what to change next…"
      : hasSelection
        ? "Edit with AI"
        : "Ask AI to write anything…";
  const showOutput = phase === "streaming" || phase === "done" || (phase === "error" && Boolean(output));
  const sourceState = aiStore.mode.kind === "image" ? aiStore.mode.sourceState : "idle";
  const sendDisabled = !value.trim() || sourceState === "loading";

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
            {output || (
              <span className="inline-flex items-center gap-1.5 text-sm text-dim">
                <Sparkles className="size-3.5 animate-pulse text-accent-color" />
                AI is writing…
              </span>
            )}
          </div>
        ) : null}
        {imageMode ? (
          <div className="flex items-center gap-2 border-b border-divider px-3 py-2">
            {imageSource ? (
              <span className="flex min-w-0 items-center gap-1.5 rounded-md border border-divider bg-panel py-0.5 pr-1 pl-1">
                <img src={imageSource.previewUrl} alt="" className="size-6 rounded object-cover" />
                <span className="max-w-[10rem] truncate text-xs text-dim">{imageSource.name}</span>
                <button
                  type="button"
                  onClick={() => aiStore.clearSource()}
                  className="flex size-4 items-center justify-center text-dim hover:text-ink"
                  title="Don't use this image as input"
                >
                  <X className="size-3" />
                </button>
              </span>
            ) : sourceState === "loading" ? (
              <span className="text-xs text-dim">Loading image…</span>
            ) : sourceState === "error" ? (
              <span className="min-w-0 truncate text-xs text-danger">{aiStore.mode.kind === "image" ? aiStore.mode.sourceError : ""}</span>
            ) : (
              <span className="text-xs font-medium text-dim">Image</span>
            )}
            {target.kind !== "image" ? (
              <button
                type="button"
                onClick={() => aiStore.exitImageMode()}
                className="ml-auto text-xs text-dim hover:text-ink"
              >
                Text
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="flex items-center gap-2 py-2 pr-2 pl-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-divider bg-panel">
            {imageMode ? (
              <ImageIcon className="size-4 text-accent-color" />
            ) : (
              <Sparkles className={cn("size-4 text-accent-color", phase === "streaming" && "animate-pulse")} />
            )}
          </div>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setSubmenuOpen(false);
              setActiveIndex(e.target.value.trim() || imageMode ? -1 : 0);
            }}
            onKeyDown={onKeyDown}
            placeholder={phase === "streaming" ? "AI is writing…" : placeholder}
            readOnly={phase === "streaming"}
            className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-dim read-only:cursor-default"
            aria-label="Instruction for AI"
          />
          {imageMode ? (
            <AiImageModelSelect
              requireImageInput={Boolean(imageSource)}
              disabled={phase === "streaming"}
              onOpenSettings={onOpenImageSettings}
              onAfterClose={() => inputRef.current?.focus()}
            />
          ) : (
            <AiModelSelect
              disabled={phase === "streaming"}
              onOpenSettings={onOpenSettings}
              onAfterClose={() => inputRef.current?.focus()}
            />
          )}
          {phase === "streaming" ? (
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
              disabled={sendDisabled}
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
        <div className="relative w-64 overflow-visible rounded-lg border border-divider bg-well py-1 shadow-[0_6px_24px_rgba(15,23,42,0.12)] dark:shadow-[0_6px_24px_rgba(0,0,0,0.5)]">
          {menu.map((item, index) => {
            const Icon = item.icon;
            const isSelected = index === activeIndex;
            const showSubmenu = item.hasSubmenu && submenuOpen && isSelected;

            return (
              <div
                key={item.id}
                className="relative"
                onMouseEnter={() => {
                  setActiveIndex(index);
                  if (item.hasSubmenu && languageSubmenu.length > 0) openLanguageSubmenu();
                  else setSubmenuOpen(false);
                }}
              >
                <button
                  type="button"
                  onClick={item.run}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm",
                    isSelected ? "bg-raised" : "",
                    item.danger ? "text-danger" : "text-ink",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon className={cn("size-4 shrink-0", item.danger ? "text-danger" : "text-accent-color")} />
                    {item.label}
                  </span>
                  {item.hasSubmenu ? (
                    <span className="flex shrink-0 items-center gap-1 text-xs text-dim">
                      <span className="max-w-[5.5rem] truncate">{item.badge}</span>
                      <ChevronRight className="size-3.5" />
                    </span>
                  ) : null}
                </button>

                {showSubmenu ? (
                  <div className="absolute top-0 left-[calc(100%+4px)] z-40 max-h-64 w-52 overflow-y-auto rounded-lg border border-divider bg-well py-1 shadow-[0_6px_24px_rgba(15,23,42,0.12)] dark:shadow-[0_6px_24px_rgba(0,0,0,0.5)]">
                    {languageSubmenu.map((lang, subIndex) => {
                      const isCurrent = lang.code === translateTarget;
                      const isSubSelected = subIndex === subActiveIndex;
                      return (
                        <button
                          key={lang.code}
                          type="button"
                          onMouseEnter={() => setSubActiveIndex(subIndex)}
                          onClick={(e) => {
                            e.stopPropagation();
                            selectLanguageAndRun(lang.code);
                          }}
                          className={cn(
                            "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm",
                            isSubSelected ? "bg-raised" : "",
                            isCurrent ? "font-medium text-accent-color" : "text-ink",
                          )}
                        >
                          <span className="min-w-0 truncate">
                            {lang.name}{" "}
                            <span className="text-xs text-dim">({lang.nativeName})</span>
                          </span>
                          {isCurrent ? <Check className="size-3.5 shrink-0 text-accent-color" /> : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
});

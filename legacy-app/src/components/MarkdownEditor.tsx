import type { BlockNoteEditor } from "@blocknote/core";
import { FormattingToolbarController, useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { observer } from "mobx-react-lite";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import "@blocknote/shadcn/style.css";
import "@/markdown-editor.css";
import { AiPromptBar } from "@/components/ai/AiPromptBar";
import { AiImageJobLayer } from "@/components/ai/AiImageJobOverlay";
import { AiOpenContext, EditorFormattingToolbar } from "@/components/ai/AiToolbarButton";
import { useImageSettings } from "@/hooks/useImageSettings";
import { captureAiTarget, restoreSelection, type AiTarget } from "@/lib/ai-editor";
import { stripAiJobImages } from "@/lib/ai-job-markdown";
import { collectTransferFiles, transferHasFiles } from "@/lib/image-optimize";
import { resolveMarkdownAssetHref } from "@/lib/page-assets-client";
import { pathForNoteId } from "@/lib/search-nav";
import { useNavigate } from "react-router-dom";
import { aiSettingsImagePath, aiSettingsTextPath } from "@/routes/paths";
import {
  ingestPageFile,
  markdownForIngestedFile,
  type IngestedPageFile,
} from "@/lib/page-file-ingest";
import { themeStore } from "@/stores/theme-store";
import { uiPreferenceStore } from "@/stores/ui-preference-store";
import { MARKDOWN_COLUMN_CLASS } from "@/components/MarkdownRawEditor";
import { noteStore } from "@/stores/note-store";
import { aiStore } from "@/stores/ai-store";
import { workspaceStore } from "@/stores/workspace-store";
import { EditorContentSkeleton } from "@/components/WorkspaceLoading";

export type MarkdownEditorHandle = {
  flushViewState(): void;
};

function blockIdAtPoint(clientX: number, clientY: number): string | null {
  const el = document.elementFromPoint(clientX, clientY);
  return el?.closest("[data-id]")?.getAttribute("data-id") ?? null;
}

function insertIngestedPageFiles(
  editor: BlockNoteEditor,
  items: IngestedPageFile[],
  dropPoint?: { clientX: number; clientY: number },
): void {
  if (items.length === 0) return;
  if (dropPoint) {
    const dropBlockId = blockIdAtPoint(dropPoint.clientX, dropPoint.clientY);
    if (dropBlockId) {
      try {
        editor.setTextCursorPosition(dropBlockId, "end");
      } catch {
        /* drop target may not be a text block */
      }
    }
  }

  let reference = editor.getTextCursorPosition().block;
  for (const ingested of items) {
    if (ingested.kind === "image" || ingested.kind === "file") {
      editor.setTextCursorPosition(reference.id, "end");
      editor.pasteMarkdown(markdownForIngestedFile(ingested));
      reference = editor.getTextCursorPosition().block;
      continue;
    }
    const type = ingested.kind === "document" ? "file" : ingested.kind;
    const inserted = editor.insertBlocks(
      [{ type, props: { url: ingested.markdownUrl, name: ingested.name } }] as never[],
      reference,
      "after",
    );
    reference = (inserted[0] ?? reference) as typeof reference;
  }
}

const BlockEditor = observer(function BlockEditor({
  workspaceId,
  noteId,
  notePath,
  initial,
  focusTitle,
  onChange,
  onFocused,
  editorRef,
}: {
  workspaceId: string;
  noteId: string;
  notePath: string;
  initial: string;
  focusTitle: boolean;
  onChange: (markdown: string) => void;
  onFocused: () => void;
  editorRef: Ref<MarkdownEditorHandle>;
}) {
  const hydrating = useRef(true);
  const initialRef = useRef(initial);
  const focusRef = useRef(focusTitle);
  const onFocusedRef = useRef(onFocused);
  onFocusedRef.current = onFocused;
  const scrollRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const caretTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRefInner = useRef<BlockNoteEditor | null>(null);
  const workspaceIdRef = useRef(workspaceId);
  const notePathRef = useRef(notePath);
  const { settings } = useImageSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  workspaceIdRef.current = workspaceId;
  notePathRef.current = notePath;

  const ingestFile = useCallback(async (file: File) => {
    return ingestPageFile({
      file,
      workspaceId: workspaceIdRef.current,
      notePath: notePathRef.current,
      settings: settingsRef.current,
    });
  }, []);

  const ingestAndInsert = useCallback(
    async (
      files: File[],
      editorInstance: BlockNoteEditor,
      dropPoint?: { clientX: number; clientY: number },
    ) => {
      if (files.length === 0 || !notePathRef.current) return;
      const results = await Promise.allSettled(files.map((file) => ingestFile(file)));
      const ingested: IngestedPageFile[] = [];
      for (const result of results) {
        if (result.status === "fulfilled") ingested.push(result.value);
        else console.error("Failed to attach file", result.reason);
      }
      insertIngestedPageFiles(editorInstance, ingested, dropPoint);
    },
    [ingestFile],
  );

  const editor = useCreateBlockNote({
    animations: false,
    uploadFile: async (file) => {
      const { markdownUrl } = await ingestFile(file);
      return markdownUrl;
    },
    resolveFileUrl: async (url) => {
      if (/^(https?:|data:|blob:)/i.test(url)) return url;
      const href = resolveMarkdownAssetHref(workspaceIdRef.current, notePathRef.current, url);
      return href ?? url;
    },
    pasteHandler: ({ event, editor: pasteEditor, defaultPasteHandler }) => {
      const files = collectTransferFiles(event.clipboardData);
      if (files.length > 0) {
        void ingestAndInsert(files, pasteEditor);
        return true;
      }
      return defaultPasteHandler({ plainTextAsMarkdown: true, prioritizeMarkdownOverHTML: true });
    },
  });

  useEffect(() => {
    editorRefInner.current = editor;
  }, [editor]);

  const editorTheme = themeStore.resolved;

  const [aiTarget, setAiTarget] = useState<AiTarget | null>(null);
  const aiTargetRef = useRef<AiTarget | null>(null);
  aiTargetRef.current = aiTarget;

  const openAi = useCallback(() => {
    const target = captureAiTarget(editor);
    if (target) setAiTarget(target);
  }, [editor]);

  const closeAi = useCallback(
    (restore: boolean) => {
      const target = aiTargetRef.current;
      setAiTarget(null);
      if (target && restore) restoreSelection(editor, target);
    },
    [editor],
  );

  const navigate = useNavigate();

  const openAiSettings = useCallback(() => {
    noteStore.checkpoint();
    navigate(aiSettingsTextPath());
  }, [navigate]);

  const openAiImageSettings = useCallback(() => {
    noteStore.checkpoint();
    navigate(aiSettingsImagePath());
  }, [navigate]);

  // ⌘J / Ctrl+J toggles the AI bar while the note has focus.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "j" || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      const active = document.activeElement;
      const inNote = editor.isFocused() || active === document.body || Boolean(active && scrollRef.current?.contains(active));
      if (!inNote) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (aiTargetRef.current) closeAi(true);
      else openAi();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [closeAi, editor, openAi]);

  useEffect(() => () => aiStore.cancelJobsForNote(noteId), [noteId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || aiTargetRef.current) return;
      const active = [...aiStore.jobs.values()]
        .filter((job) => job.noteId === noteId && (job.phase === "generating" || job.phase === "saving"))
        .sort((a, b) => b.startedAt - a.startedAt)[0];
      if (!active) return;
      event.preventDefault();
      aiStore.cancelJob(active.id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [noteId]);

  const saveViewState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    let caret: { blockId: string } | undefined;
    try {
      const pos = editor.getTextCursorPosition();
      if (pos?.block?.id) caret = { blockId: pos.block.id };
    } catch {
      /* editor not ready */
    }
    uiPreferenceStore.setNoteUI(workspaceId, noteId, {
      scrollTop: el.scrollTop,
      scrollLeft: el.scrollLeft,
      caret,
    });
  }, [editor, noteId, workspaceId]);

  useImperativeHandle(editorRef, () => ({ flushViewState: saveViewState }), [saveViewState]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // A note that is only an empty heading ("# ") opens as an empty title, not a literal "#".
      const blankTitle = /^\s*#{1,6}\s*$/.test(initialRef.current);
      const parsed = await editor.tryParseMarkdownToBlocks(
        blankTitle ? "" : stripAiJobImages(initialRef.current || ""),
      );
      if (cancelled) return;
      const blocks = focusRef.current || blankTitle ? withEmptyTitle(parsed) : parsed;
      editor.replaceBlocks(editor.document, blocks);

      const saved = uiPreferenceStore.getNoteUI(workspaceId, noteId);
      if (focusRef.current && editor.document[0]) {
        editor.focus();
        editor.setTextCursorPosition(editor.document[0], "start");
        onFocusedRef.current();
      } else if (saved?.caret?.blockId) {
        const block = editor.document.find((b) => b.id === saved.caret!.blockId);
        if (block) editor.setTextCursorPosition(block, "start");
      }

      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el && saved && (saved.scrollTop > 0 || saved.scrollLeft > 0)) {
          el.scrollTop = saved.scrollTop;
          el.scrollLeft = saved.scrollLeft;
        }
      });

      queueMicrotask(() => {
        hydrating.current = false;
      });
    })();
    return () => {
      cancelled = true;
      saveViewState();
    };
  }, [editor, noteId, saveViewState, workspaceId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => saveViewState();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [saveViewState]);

  const scheduleCaretSave = () => {
    if (caretTimer.current) clearTimeout(caretTimer.current);
    caretTimer.current = setTimeout(() => saveViewState(), 200);
  };

  return (
    <div
      ref={scrollRef}
      className="gtm-md-editor min-h-0 flex-1 overflow-auto bg-well"
      onDragOverCapture={(event) => {
        if (!transferHasFiles(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDropCapture={(event) => {
        const files = collectTransferFiles(event.dataTransfer);
        if (files.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        const editorInstance = editorRefInner.current;
        if (!editorInstance) return;
        void ingestAndInsert(files, editorInstance, {
          clientX: event.clientX,
          clientY: event.clientY,
        });
      }}
    >
      <div ref={columnRef} className={`relative ${MARKDOWN_COLUMN_CLASS}`}>
        <AiOpenContext.Provider value={openAi}>
          <BlockNoteView
            editor={editor}
            theme={editorTheme}
            sideMenu={false}
            formattingToolbar={false}
            onChange={() => {
              if (hydrating.current) return;
              onChange(stripAiJobImages(editor.blocksToMarkdownLossy(editor.document)));
              scheduleCaretSave();
            }}
          >
            <FormattingToolbarController formattingToolbar={EditorFormattingToolbar} />
          </BlockNoteView>
        </AiOpenContext.Provider>
        {aiTarget ? (
          <AiPromptBar
            editor={editor}
            target={aiTarget}
            containerRef={columnRef}
            workspaceId={workspaceId}
            noteId={noteId}
            notePath={notePath}
            imageSettings={settings}
            onClose={closeAi}
            onOpenSettings={openAiSettings}
            onOpenImageSettings={openAiImageSettings}
          />
        ) : null}
        <AiImageJobLayer editor={editor} noteId={noteId} containerRef={columnRef} />
      </div>
    </div>
  );
});

function withEmptyTitle<T>(blocks: T[]): T[] {
  const heading = { type: "heading", props: { level: 1 }, content: "" } as T;
  const paragraph = { type: "paragraph", content: "" } as T;
  if (blocks.length === 0) return [heading, paragraph];
  const first = blocks[0] as { type?: string };
  if (first.type === "heading") return blocks;
  return [heading, ...blocks];
}

export const MarkdownEditor = observer(
  forwardRef<MarkdownEditorHandle, { workspaceId: string }>(function MarkdownEditor({ workspaceId }, ref) {
    const noteId = noteStore.openNoteId;
    const notePath = noteId ? (pathForNoteId(noteId) ?? `${noteId}.md`) : null;

    if (!noteId || !notePath) {
      if (workspaceStore.treeLoading || workspaceStore.booting) {
        return <EditorContentSkeleton />;
      }
      return <div className="flex flex-1 items-center justify-center text-sm text-dim">Select a note or create one.</div>;
    }
    if (noteStore.loadFailed) {
      return (
        <div className="flex flex-1 items-center justify-center text-sm text-dim">
          This note isn’t on this device yet. It opens once you’re back online.
        </div>
      );
    }
    if (!noteStore.editorReady) return <EditorContentSkeleton />;

    return (
      <BlockEditor
        key={`${noteId}:${noteStore.hydrateToken}`}
        workspaceId={workspaceId}
        noteId={noteId}
        notePath={notePath}
        initial={noteStore.content}
        focusTitle={noteStore.focusTitleNoteId === noteId}
        onFocused={() => noteStore.consumeTitleFocus(noteId)}
        onChange={(markdown) => noteStore.setContent(workspaceId, markdown)}
        editorRef={ref}
      />
    );
  }),
);

import { inlineContentToNodes, type Block, type BlockNoteEditor } from "@blocknote/core";
import type { AiGenerateRequest } from "@/lib/ai-generate";
import { isAiJobImageName, stripAiJobImages } from "@/lib/ai-job-markdown";

// Loose typing: these helpers work on whatever schema the note editor uses.
type AnyBlock = Block<any, any, any>;
type Editor = BlockNoteEditor<any, any, any>;

type ResolvedPos = ReturnType<Editor["prosemirrorState"]["doc"]["resolve"]>;

/** What the AI bar was opened on, captured before focus moves to its input. */
export type AiTarget =
  /** Text inside one block; the reply replaces just that range. */
  | { kind: "inline"; blockId: string; from: number; to: number; text: string; markdown: string; document: string }
  /** A selection across blocks; the reply replaces those whole blocks. */
  | { kind: "blocks"; blockIds: string[]; markdown: string; document: string }
  /** No selection; the reply goes after (or into, when empty) the cursor block. */
  | { kind: "cursor"; blockId: string; replaceEmpty: boolean; contextMarkdown: string; document: string }
  /** An existing image; a new image is generated from it and inserted below. */
  | { kind: "image"; blockId: string; url: string; name: string; document: string };

function blockIdAt($pos: ResolvedPos): string | null {
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === "blockContainer") return node.attrs.id as string;
  }
  return null;
}

function hasInlineContent(block: AnyBlock): block is AnyBlock & { content: any[] } {
  return Array.isArray(block.content);
}

function isEmptyBlock(block: AnyBlock): boolean {
  return hasInlineContent(block) && block.content.length === 0 && block.children.length === 0;
}

function trimMarkdown(markdown: string): string {
  return markdown.replace(/\n+$/, "");
}

function imageTargetFromBlock(block: AnyBlock | undefined, document: string): AiTarget | null {
  if (!block || block.type !== "image") return null;
  const props = block.props as { url?: string; name?: string };
  const url = (props.url ?? "").trim();
  const name = props.name ?? "";
  if (!url || isAiJobImageName(name)) return null;
  return { kind: "image", blockId: block.id, url, name: name || "image", document };
}

export function captureAiTarget(editor: Editor): AiTarget | null {
  const state = editor.prosemirrorState;
  const { selection } = state;
  const document = stripAiJobImages(trimMarkdown(editor.blocksToMarkdownLossy(editor.document)));

  if (!selection.empty) {
    const selected = editor.getSelection()?.blocks ?? [];
    if (selected.length === 1) {
      const image = imageTargetFromBlock(selected[0], document);
      if (image) return image;
    }
  } else {
    let cursorBlock: AnyBlock | undefined;
    try {
      cursorBlock = editor.getTextCursorPosition().block;
    } catch {
      cursorBlock = undefined;
    }
    const image = imageTargetFromBlock(cursorBlock, document);
    if (image) return image;
  }

  if (selection.empty) {
    const block = editor.getTextCursorPosition().block;
    let context: AnyBlock | undefined = block;
    while (context && isEmptyBlock(context)) context = editor.getPrevBlock(context);
    return {
      kind: "cursor",
      blockId: block.id,
      replaceEmpty: isEmptyBlock(block),
      contextMarkdown: context ? trimMarkdown(editor.blocksToMarkdownLossy([context])) : "",
      document,
    };
  }

  const { $from, $to, from, to } = selection;
  if ($from.parent === $to.parent && $from.parent.isTextblock) {
    const blockId = blockIdAt($from);
    if (!blockId) return null;
    const text = state.doc.textBetween(from, to, "\n");
    let markdown = text;
    const cut = editor.getSelectionCutBlocks().blocks[0];
    if (cut && hasInlineContent(cut)) {
      markdown = trimMarkdown(editor.blocksToMarkdownLossy([{ type: "paragraph", content: cut.content }]));
    }
    return { kind: "inline", blockId, from, to, text, markdown: markdown || text, document };
  }

  const blocks = editor.getSelection()?.blocks ?? [];
  if (blocks.length === 0) return null;
  return {
    kind: "blocks",
    blockIds: blocks.map((b) => b.id),
    markdown: trimMarkdown(editor.blocksToMarkdownLossy(blocks)),
    document,
  };
}

export function aiRequestContext(target: AiTarget): Omit<AiGenerateRequest, "turns"> {
  if (target.kind === "cursor") return { document: target.document, cursorBlock: target.contextMarkdown };
  if (target.kind === "image") return { document: target.document };
  return { document: target.document, selection: { kind: target.kind, markdown: target.markdown } };
}

export function aiHasSelection(target: AiTarget): boolean {
  return target.kind === "inline" || target.kind === "blocks";
}

/** Block the bar anchors under and "Insert below" inserts after. */
export function aiAnchorBlockId(target: AiTarget): string {
  if (target.kind === "blocks") return target.blockIds[target.blockIds.length - 1];
  return target.blockId;
}

export function blockElement(editor: Editor, blockId: string): HTMLElement | null {
  return editor.domElement?.querySelector<HTMLElement>(`[data-node-type="blockOuter"][data-id="${CSS.escape(blockId)}"]`) ?? null;
}

/** Bottom edge, in viewport coordinates, of the text the bar points at. */
export function aiAnchorBottom(editor: Editor, target: AiTarget): number | null {
  if (target.kind === "inline") {
    try {
      return editor.prosemirrorView.coordsAtPos(Math.min(target.to, editor.prosemirrorState.doc.content.size)).bottom;
    } catch {
      // fall back to the block box
    }
  }
  const el = blockElement(editor, aiAnchorBlockId(target));
  if (!el) return null;
  const content = el.querySelector<HTMLElement>(".bn-block-content") ?? el;
  return content.getBoundingClientRect().bottom;
}

const HIGHLIGHT_NAME = "dotnote-ai-target";

/**
 * Keep the target visibly selected while focus sits in the AI bar, using the
 * CSS Custom Highlight API so the document itself is never touched.
 */
export function showAiHighlight(editor: Editor, target: AiTarget): () => void {
  const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
  const HighlightCtor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (!highlights || !HighlightCtor || target.kind === "cursor") return () => {};

  const range = document.createRange();
  try {
    if (target.kind === "image") {
      const el = blockElement(editor, target.blockId);
      if (!el) return () => {};
      range.setStartBefore(el);
      range.setEndAfter(el);
    } else if (target.kind === "inline") {
      const view = editor.prosemirrorView;
      const start = view.domAtPos(target.from);
      const end = view.domAtPos(target.to);
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
    } else {
      const first = blockElement(editor, target.blockIds[0]);
      const last = blockElement(editor, target.blockIds[target.blockIds.length - 1]);
      if (!first || !last) return () => {};
      range.setStartBefore(first);
      range.setEndAfter(last);
    }
  } catch {
    return () => {};
  }
  highlights.set(HIGHLIGHT_NAME, new HighlightCtor(range));
  return () => highlights.delete(HIGHLIGHT_NAME);
}

/** Collapse the selection so BlockNote's formatting toolbar steps aside. */
export function collapseSelection(editor: Editor, target: AiTarget): void {
  if (target.kind === "image") return;
  if (target.kind === "inline") editor._tiptapEditor.commands.setTextSelection(target.to);
  else if (target.kind === "blocks") editor.setTextCursorPosition(aiAnchorBlockId(target), "end");
}

/** Put the original selection back when the bar is dismissed. */
export function restoreSelection(editor: Editor, target: AiTarget): void {
  editor.focus();
  try {
    if (target.kind === "inline") {
      editor._tiptapEditor.commands.setTextSelection({ from: target.from, to: target.to });
    } else if (target.kind === "blocks") {
      editor.setSelection(target.blockIds[0], target.blockIds[target.blockIds.length - 1]);
    } else if (target.kind === "image") {
      editor.setSelection(target.blockId, target.blockId);
    } else {
      editor.setTextCursorPosition(target.blockId, "end");
    }
  } catch {
    // the target moved or was deleted while the bar was open
  }
}

function placeCursorAfter(editor: Editor, blocks: AnyBlock[]): void {
  const last = blocks[blocks.length - 1];
  editor.focus();
  if (!last) return;
  try {
    editor.setTextCursorPosition(last.id, "end");
  } catch {
    // non-text blocks (images, tables) cannot hold the cursor
  }
}

export type AiApplyMode = "replace" | "insert";

/**
 * Write the AI output into the note as one undoable change. Returns false when
 * the target changed underneath the bar and the output went below it instead.
 */
export async function applyAiOutput(
  editor: Editor,
  target: AiTarget,
  output: string,
  mode: AiApplyMode,
): Promise<boolean> {
  const parsed = await editor.tryParseMarkdownToBlocks(output.trim());
  if (parsed.length === 0) return true;

  const insertBelow = () => {
    const inserted = editor.insertBlocks(parsed, aiAnchorBlockId(target), "after");
    placeCursorAfter(editor, inserted);
  };

  if (mode === "insert") {
    insertBelow();
    return true;
  }

  if (target.kind === "cursor") {
    const block = editor.getBlock(target.blockId);
    if (!block) {
      insertBelow();
      return false;
    }
    if (target.replaceEmpty && isEmptyBlock(block)) {
      const { insertedBlocks } = editor.replaceBlocks([block.id], parsed);
      placeCursorAfter(editor, insertedBlocks);
    } else {
      insertBelow();
    }
    return true;
  }

  if (target.kind === "blocks") {
    if (!target.blockIds.every((id) => editor.getBlock(id))) {
      insertBelow();
      return false;
    }
    const { insertedBlocks } = editor.replaceBlocks(target.blockIds, parsed);
    placeCursorAfter(editor, insertedBlocks);
    return true;
  }

  if (target.kind === "image") {
    insertBelow();
    return true;
  }

  const doc = editor.prosemirrorState.doc;
  const unchanged = target.to <= doc.content.size && doc.textBetween(target.from, target.to, "\n") === target.text;
  if (!unchanged) {
    insertBelow();
    return false;
  }

  const [first] = parsed;
  if (parsed.length === 1 && first.type === "paragraph" && hasInlineContent(first)) {
    editor.transact((tr) => {
      tr.replaceWith(target.from, target.to, inlineContentToNodes(first.content, editor.pmSchema));
    });
    editor.focus();
    return true;
  }

  // Structured output over inline text: paste it so ProseMirror splits the block.
  editor.focus();
  editor._tiptapEditor.commands.setTextSelection({ from: target.from, to: target.to });
  editor.pasteMarkdown(output.trim());
  return true;
}

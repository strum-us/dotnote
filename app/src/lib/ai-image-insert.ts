import type { BlockNoteEditor } from "@blocknote/core";
import { aiAnchorBlockId, type AiTarget } from "@/lib/ai-editor";
import type { ImageOptimizationSettings } from "@/lib/image-settings";
import { ingestPageFile, markdownForIngestedFile } from "@/lib/page-file-ingest";

function extensionFromBlob(blob: Blob): string {
  const mime = (blob.type || "").toLowerCase();
  if (mime.includes("webp")) return "webp";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("gif")) return "gif";
  return "png";
}

export async function insertGeneratedImageAtTarget(
  editor: BlockNoteEditor,
  target: AiTarget,
  workspaceId: string,
  notePath: string,
  blob: Blob,
  settings: ImageOptimizationSettings,
): Promise<void> {
  const ext = extensionFromBlob(blob);
  const file = new File([blob], `ai-generated.${ext}`, { type: blob.type || "image/png" });
  const ingested = await ingestPageFile({ file, workspaceId, notePath, settings });
  try {
    editor.setTextCursorPosition(aiAnchorBlockId(target), "end");
  } catch {
    // anchor block may not accept a text cursor (e.g. image-only)
  }
  editor.pasteMarkdown(markdownForIngestedFile(ingested));
}

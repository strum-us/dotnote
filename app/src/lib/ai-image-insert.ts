import type { BlockNoteEditor } from "@blocknote/core";
import { aiAnchorBlockId, type AiTarget } from "@/lib/ai-editor";
import { AI_JOB_PLACEHOLDER_URL, aiJobImageName } from "@/lib/ai-job-markdown";
import type { ImageOptimizationSettings } from "@/lib/image-settings";
import { ingestPageFile } from "@/lib/page-file-ingest";

function extensionFromBlob(blob: Blob): string {
  const mime = (blob.type || "").toLowerCase();
  if (mime.includes("webp")) return "webp";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("gif")) return "gif";
  return "png";
}

type Editor = BlockNoteEditor<any, any, any>;

export function insertImagePlaceholder(editor: Editor, target: AiTarget, jobId: string): string {
  const [block] = editor.insertBlocks(
    [
      {
        type: "image",
        props: {
          url: AI_JOB_PLACEHOLDER_URL,
          name: aiJobImageName(jobId),
          caption: "",
          showPreview: true,
        },
      },
    ] as never[],
    aiAnchorBlockId(target),
    "after",
  );
  return block.id;
}

export async function completeImagePlaceholder(
  editor: Editor,
  placeholderBlockId: string,
  anchorBlockId: string,
  blob: Blob,
  ctx: { workspaceId: string; notePath: string; settings: ImageOptimizationSettings },
): Promise<void> {
  const ext = extensionFromBlob(blob);
  const file = new File([blob], `ai-generated.${ext}`, { type: blob.type || "image/png" });
  const ingested = await ingestPageFile({ file, ...ctx });
  const props = { url: ingested.markdownUrl, name: ingested.name, caption: "" };
  try {
    editor.updateBlock(placeholderBlockId, { type: "image", props } as never);
    return;
  } catch {
    // The placeholder was removed while the request was in flight.
  }
  try {
    editor.insertBlocks([{ type: "image", props }] as never[], anchorBlockId, "after");
  } catch {
    throw new Error("The image was saved but could not be placed in the note.");
  }
}

export function removeImagePlaceholder(editor: Editor, blockId: string): void {
  try {
    editor.removeBlocks([blockId]);
  } catch {
    // already gone
  }
}

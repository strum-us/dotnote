import { assetApi } from "@/lib/api";
import { blobToBase64, optimizeImage } from "@/lib/image-optimize";
import type { ImageOptimizationSettings } from "@/lib/image-settings";
import {
  classifyPageFile,
  extensionFromFilename,
  humanizeAssetFilename,
  pageAssetFilename,
  pageAssetMarkdownUrl,
  type PageAssetKind,
} from "@/lib/page-assets-client";

export type IngestedPageFile = {
  markdownUrl: string;
  name: string;
  kind: PageAssetKind;
  ext: string;
};

export async function ingestPageFile(opts: {
  file: File;
  workspaceId: string;
  notePath: string;
  settings: ImageOptimizationSettings;
}): Promise<IngestedPageFile> {
  const kind = classifyPageFile(opts.file);
  let blob: Blob = opts.file;
  let ext = extensionFromFilename(opts.file.name);

  if (kind === "image") {
    const isGif = (opts.file.type || "").includes("gif") || ext === "gif";
    if (isGif) {
      ext = "gif";
    } else {
      const optimized = await optimizeImage(opts.file, opts.settings);
      blob = optimized.file;
      ext = extensionFromMimeType(optimized.mimeType, ext);
    }
  } else if (!ext) {
    ext = "bin";
  }

  const filename = pageAssetFilename(opts.file.name, ext);
  const mimeType = blob.type || undefined;
  await assetApi.save(opts.workspaceId, opts.notePath, filename, await blobToBase64(blob), mimeType);
  return {
    markdownUrl: pageAssetMarkdownUrl(opts.notePath, filename),
    name: humanizeAssetFilename(filename, kind === "image" ? "image" : "file"),
    kind,
    ext,
  };
}

export function markdownForIngestedFile(ingested: IngestedPageFile): string {
  switch (ingested.kind) {
    case "image":
      return `![${ingested.name}](${ingested.markdownUrl})`;
    case "video":
      return `<video src="${ingested.markdownUrl}" controls></video>`;
    case "audio":
      return `<audio src="${ingested.markdownUrl}" controls></audio>`;
    default:
      return `[${ingested.name}](${ingested.markdownUrl})`;
  }
}

function extensionFromMimeType(mimeType: string, fallbackExt: string): string {
  const mime = mimeType.toLowerCase();
  if (mime === "image/gif") return "gif";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/jpeg") return "jpg";
  return fallbackExt || "webp";
}

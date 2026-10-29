import { apiFetch } from "@/lib/api-origin";
import { blobToBase64 } from "@/lib/image-optimize";
import { resolveMarkdownAssetHref } from "@/lib/page-assets-client";
import { isImageInputMimeType, type AiSourceImagePayload } from "@shared/llm";

export type LoadedSourceImage = AiSourceImagePayload & {
  blockId: string;
  url: string;
  name: string;
  previewUrl: string;
};

const MAX_SOURCE_BASE64 = 10_000_000;

export async function loadSourceImage(opts: {
  blockId: string;
  url: string;
  name: string;
  workspaceId: string;
  notePath: string;
}): Promise<LoadedSourceImage> {
  const blob = await fetchSourceBlob(opts);
  const mimeType = blob.type || "image/png";
  if (!isImageInputMimeType(mimeType)) {
    throw new Error("This image format can't be sent to the model. Use PNG, JPEG, or WebP.");
  }
  const dataBase64 = await blobToBase64(blob);
  if (dataBase64.length > MAX_SOURCE_BASE64) {
    throw new Error("This image is too large to send. Try a smaller one.");
  }
  return {
    blockId: opts.blockId,
    url: opts.url,
    name: opts.name,
    mimeType,
    dataBase64,
    previewUrl: URL.createObjectURL(blob),
  };
}

async function fetchSourceBlob(opts: { url: string; workspaceId: string; notePath: string }): Promise<Blob> {
  if (opts.url.startsWith("data:") || /^https?:/i.test(opts.url)) {
    const res = await fetch(opts.url);
    if (!res.ok) throw new Error("Could not load this image.");
    return res.blob();
  }
  const href = resolveMarkdownAssetHref(opts.workspaceId, opts.notePath, opts.url);
  if (!href) throw new Error("Could not load this image.");
  const res = await apiFetch(href);
  if (!res.ok) throw new Error("Could not load this image.");
  return res.blob();
}

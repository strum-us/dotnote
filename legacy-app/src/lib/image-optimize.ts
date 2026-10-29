import imageCompression from "browser-image-compression";

import {
  DEFAULT_IMAGE_OPTIMIZATION_SETTINGS,
  maxWidthForSizeLevel,
  maxWidthOrHeightForTargetWidthPx,
  shouldResizeImageToTargetWidth,
  type ImageOptimizationSettings,
} from "./image-settings";

function fileIdentity(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function collectTransferFiles(data: DataTransfer | null): File[] {
  if (!data) return [];

  const seen = new Set<string>();
  const out: File[] = [];
  const add = (file: File | null | undefined) => {
    if (!file || file.size <= 0) return;
    const key = fileIdentity(file);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(file);
  };

  if (data.files?.length) {
    for (let i = 0; i < data.files.length; i++) add(data.files[i]);
  }
  if (out.length === 0 && data.items?.length) {
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      if (item.kind !== "file") continue;
      add(item.getAsFile());
    }
  }
  return out;
}

export function transferHasFiles(data: DataTransfer | null): boolean {
  if (!data) return false;
  const types = Array.from(data.types ?? []);
  return types.includes("Files") || (data.files?.length ?? 0) > 0;
}

async function rasterImageDimensions(
  blob: Blob,
): Promise<{ widthPx: number; heightPx: number } | undefined> {
  try {
    const bitmap = await createImageBitmap(blob);
    const widthPx = bitmap.width;
    const heightPx = bitmap.height;
    bitmap.close();
    return { widthPx, heightPx };
  } catch {
    return undefined;
  }
}

async function encodeBlobAsPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get 2d context");
    ctx.drawImage(bitmap, 0, 0);
    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (out) => {
          if (out) resolve(out);
          else reject(new Error("PNG export failed"));
        },
        "image/png",
      );
    });
  } finally {
    bitmap.close();
  }
}

export async function optimizeImage(
  file: File,
  settings: ImageOptimizationSettings = DEFAULT_IMAGE_OPTIMIZATION_SETTINGS,
): Promise<{ file: File | Blob; mimeType: string }> {
  const mimeType = file.type || "application/octet-stream";
  if (mimeType === "image/gif") {
    return { file, mimeType };
  }

  if (settings.format === "png") {
    if (mimeType === "image/png") {
      return { file, mimeType };
    }
    const png = await encodeBlobAsPng(file);
    return { file: png, mimeType: "image/png" };
  }

  const dims = await rasterImageDimensions(file);
  const targetWidth = maxWidthForSizeLevel(settings.sizeLevel, settings.maxWidth);
  const shouldResize =
    dims != null && shouldResizeImageToTargetWidth(dims.widthPx, targetWidth);
  const shouldConvertWebp = mimeType !== "image/webp";

  if (!shouldResize && !shouldConvertWebp) {
    return { file, mimeType };
  }

  const compressionOptions: Parameters<typeof imageCompression>[1] = {
    initialQuality: settings.quality,
    maxSizeMB: 2,
    useWebWorker: true,
    fileType: "image/webp",
  };
  if (shouldResize && dims != null && targetWidth !== undefined) {
    compressionOptions.maxWidthOrHeight = maxWidthOrHeightForTargetWidthPx(
      dims.widthPx,
      dims.heightPx,
      targetWidth,
    );
  }

  const output = await imageCompression(file, compressionOptions);
  return {
    file: output,
    mimeType: output.type || "image/webp",
  };
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(blob);
  });
}

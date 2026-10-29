export type PageAssetKind = "image" | "video" | "audio" | "document" | "file";

export const IMAGE_ASSET_EXT_RE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
export const VIDEO_ASSET_EXT_RE = /\.(mp4|webm|ogv|mov|mkv|m4v|avi|wmv|flv)$/i;
export const AUDIO_ASSET_EXT_RE = /\.(mp3|wav|ogg|m4a|aac|flac|opus)$/i;
export const DOCUMENT_ASSET_EXT_RE =
  /\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|epub|pages|numbers|key|csv)$/i;
export const BLOCKED_ASSET_EXT_RE =
  /\.(md|ya?ml|html?|jsx?|mjs|cjs|tsx?|exe|bat|cmd|sh|ps1|dll|so|app)$/i;
export const SHORT_ASSET_ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
export const SHORT_ASSET_ID_LENGTH = 8;

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function markdownStem(notePath: string): string {
  const base = notePath.replace(/\\/g, "/").split("/").pop() ?? "";
  return base.replace(/\.md$/i, "") || "untitled";
}

export function pageAssetFolderName(notePath: string): string {
  return `.${markdownStem(notePath)}`;
}

export function slugifyFilename(name: string, fallback = "image"): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
  const stem = base.replace(/\.[^./]+$/, "");
  return slugify(stem) || fallback;
}

export function extensionFromFilename(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function shortAssetId(randomBytes: (length: number) => Uint8Array): string {
  const bytes = randomBytes(SHORT_ASSET_ID_LENGTH);
  let id = "";
  for (let i = 0; i < SHORT_ASSET_ID_LENGTH; i++) {
    id += SHORT_ASSET_ID_ALPHABET[(bytes[i] ?? 0) % SHORT_ASSET_ID_ALPHABET.length];
  }
  return id;
}

export function pageAssetFilename(
  originalName: string,
  ext: string,
  id?: string,
  randomBytes?: (length: number) => Uint8Array,
): string {
  const safeExt = ext.replace(/^\./, "").toLowerCase() || "webp";
  const fallback = IMAGE_ASSET_EXT_RE.test(`.${safeExt}`) ? "image" : "file";
  const assetId =
    id ??
    shortAssetId(
      randomBytes ??
        ((length: number) => {
          const bytes = new Uint8Array(length);
          crypto.getRandomValues(bytes);
          return bytes;
        }),
    );
  return `${assetId}-${slugifyFilename(originalName, fallback)}.${safeExt}`;
}

export function markdownDir(notePath: string): string {
  const normalized = notePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(0, slash) : "";
}

export function pageAssetRelativePath(notePath: string, filename: string): string {
  const dir = markdownDir(notePath);
  const folder = pageAssetFolderName(notePath);
  return dir ? `${dir}/${folder}/${filename}` : `${folder}/${filename}`;
}

export function pageAssetMarkdownUrl(notePath: string, filename: string): string {
  return `./${pageAssetFolderName(notePath)}/${filename}`;
}

export function classifyPageFile(file: { name: string; type?: string }): PageAssetKind {
  const mime = (file.type || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  const ext = extensionFromFilename(file.name);
  if (IMAGE_ASSET_EXT_RE.test(`.${ext}`)) return "image";
  if (VIDEO_ASSET_EXT_RE.test(`.${ext}`)) return "video";
  if (AUDIO_ASSET_EXT_RE.test(`.${ext}`)) return "audio";
  if (DOCUMENT_ASSET_EXT_RE.test(`.${ext}`)) return "document";
  if (!ext || BLOCKED_ASSET_EXT_RE.test(`.${ext}`)) return "file";
  return "file";
}

export function humanizeAssetFilename(filename: string, fallback = "file"): string {
  const stem = filename
    .replace(/\.[^./]+$/, "")
    .replace(/^[A-Z0-9]{8}-/, "");
  const words = stem.split(/[-_]+/).filter(Boolean);
  if (words.length === 0) return fallback;
  return words.join(" ");
}

export const MAX_PAGE_ASSET_BYTES = 512 * 1024 * 1024;

export function mimeTypeFromAssetFilename(filename: string): string {
  const ext = extensionFromFilename(filename);
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "avif":
      return "image/avif";
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "ogv":
      return "video/ogg";
    case "mov":
      return "video/quicktime";
    case "m4v":
      return "video/x-m4v";
    case "mkv":
      return "video/x-matroska";
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "ogg":
      return "audio/ogg";
    case "m4a":
      return "audio/mp4";
    case "aac":
      return "audio/aac";
    case "flac":
      return "audio/flac";
    case "opus":
      return "audio/opus";
    case "pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

function cleanedAssetPath(relativePath: string): string | null {
  if (!relativePath || relativePath.includes("\0")) return null;
  const cleaned = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("..")) return null;
  const segments = cleaned.split("/");
  if (segments.some((seg) => seg === "" || seg === "." || seg === "..")) return null;
  return cleaned;
}

export function isPageAssetPath(relativePath: string): boolean {
  const cleaned = cleanedAssetPath(relativePath);
  if (!cleaned) return false;
  const ext = extensionFromFilename(cleaned);
  if (!ext) return false;
  return !BLOCKED_ASSET_EXT_RE.test(`.${ext}`);
}

export function resolveMarkdownAssetPath(notePath: string, href: string): string | null {
  if (!href || /^(https?:|data:|blob:|\/api\/)/i.test(href)) return null;
  const relative = href.replace(/^\.\//, "");
  const dir = markdownDir(notePath);
  const joined = dir ? `${dir}/${relative}` : relative;
  const normalized = joined.replace(/\/{2,}/g, "/");
  if (!isPageAssetPath(normalized)) return null;
  return normalized;
}

import {
  classifyPageFile,
  extensionFromFilename,
  humanizeAssetFilename,
  isPageAssetPath,
  MAX_PAGE_ASSET_BYTES,
  mimeTypeFromAssetFilename,
  pageAssetFilename,
  pageAssetMarkdownUrl,
  type PageAssetKind,
} from "@shared/page-assets";
import { replaceMarkdownTitle, titleFromMarkdown } from "@shared/title";

export const SKIP_DIR_NAMES = new Set([".git", "node_modules", ".obsidian", ".trash"]);

export type SourceMeta = {
  size: number;
  mimeType: string;
};

export type PlannedAsset = {
  sourcePath: string;
  filename: string;
  mimeType: string;
};

export type PlannedFolder = {
  id: string;
  parentId: string | null;
  name: string;
  sourcePath: string;
};

export type PlannedNote = {
  id: string;
  sourcePath: string;
  parentFolderId: string | null;
  assets: PlannedAsset[];
};

export type ImportPlan = {
  folders: PlannedFolder[];
  notes: PlannedNote[];
};

export type ImportPathError = {
  path: string;
  message: string;
};

const REMOTE_HREF = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const CODE_BLOCK = /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`/g;

export function isMarkdownPath(path: string): boolean {
  return /\.(?:md|markdown)$/i.test(path);
}

export function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(0, slash) : "";
}

/** Resolve a link against the markdown file. `null` when it leaves the picked folder. */
export function normalizeRelative(fromDir: string, href: string): string | null {
  const parts = fromDir ? fromDir.split("/") : [];
  for (const segment of href.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  const path = parts.join("/");
  return path || null;
}

export function resolveLocalPath(fromFile: string, href: string, files: ReadonlySet<string>): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const noHash = (trimmed.split("#")[0] ?? "").split("?")[0] ?? "";
  if (!noHash || REMOTE_HREF.test(noHash)) return null;
  let decoded = noHash;
  try {
    decoded = decodeURIComponent(noHash);
  } catch {
    /* keep the raw href */
  }
  if (decoded.startsWith("<") && decoded.endsWith(">")) decoded = decoded.slice(1, -1);
  const relative = normalizeRelative(dirname(fromFile), decoded);
  if (relative && files.has(relative)) return relative;
  const base = decoded.split("/").filter(Boolean).pop();
  if (!base || base.includes("/")) return null;
  const matches: string[] = [];
  for (const file of files) {
    if (file === base || file.endsWith(`/${base}`)) matches.push(file);
  }
  return matches.length === 1 ? matches[0]! : null;
}

function looksLocal(href: string): boolean {
  if (!href || REMOTE_HREF.test(href) || href.startsWith("#")) return false;
  if (href.startsWith("./") || href.startsWith("../") || href.startsWith("/")) return true;
  const path = href.split("?")[0] ?? href;
  return /\.[a-z0-9]{1,8}$/i.test(path);
}

function splitDest(raw: string): { href: string; suffix: string } {
  const trimmed = raw.trim();
  if (trimmed.startsWith("<")) {
    const end = trimmed.indexOf(">");
    if (end > 1) return { href: trimmed.slice(1, end), suffix: trimmed.slice(end + 1) };
  }
  const titled = /^(.*?)(\s+"[^"]*")$/.exec(trimmed);
  if (titled?.[1]) return { href: titled[1], suffix: titled[2] ?? "" };
  return { href: trimmed, suffix: "" };
}

function maskCode(content: string): { masked: string; blocks: string[] } {
  const blocks: string[] = [];
  const masked = content.replace(CODE_BLOCK, (block) => {
    const token = `\u0000C${blocks.length}\u0000`;
    blocks.push(block);
    return token;
  });
  return { masked, blocks };
}

function unmaskCode(masked: string, blocks: string[]): string {
  return masked.replace(/\u0000C(\d+)\u0000/g, (_, index: string) => blocks[Number(index)] ?? "");
}

type UrlSwap = {
  url: string;
  kind: PageAssetKind;
  name: string;
};

function markdownForAsset(swap: UrlSwap, alt: string): string {
  if (swap.kind === "image") return `![${alt}](${swap.url})`;
  if (swap.kind === "video") return `<video src="${swap.url}" controls></video>`;
  if (swap.kind === "audio") return `<audio src="${swap.url}" controls></audio>`;
  return `[${alt}](${swap.url})`;
}

function fileMime(meta: SourceMeta | undefined, sourcePath: string): string {
  if (meta?.mimeType) return meta.mimeType;
  return mimeTypeFromAssetFilename(sourcePath);
}

/**
 * Find local files a markdown note links to, and the names they will use
 * beside that note. Markdown targets stay as notes and are not returned.
 */
export function collectNoteAssets(
  content: string,
  sourcePath: string,
  files: ReadonlyMap<string, SourceMeta>,
): { assets: PlannedAsset[]; errors: ImportPathError[] } {
  const known = new Set(files.keys());
  const assets: PlannedAsset[] = [];
  const errors: ImportPathError[] = [];
  const seen = new Set<string>();
  const reported = new Set<string>();

  const consider = (href: string) => {
    if (!looksLocal(href)) return;
    const resolved = resolveLocalPath(sourcePath, href, known);
    if (!resolved) {
      if (reported.has(href)) return;
      reported.add(href);
      errors.push({ path: href, message: "Linked file is outside the folder or missing" });
      return;
    }
    if (seen.has(resolved) || isMarkdownPath(resolved)) return;
    seen.add(resolved);
    const meta = files.get(resolved);
    if (meta && meta.size > MAX_PAGE_ASSET_BYTES) {
      errors.push({ path: resolved, message: "File is larger than 512 MB" });
      return;
    }
    const filename = pageAssetFilename(resolved.split("/").pop() ?? "file", extensionFromFilename(resolved) || "bin");
    if (!isPageAssetPath(`file/${filename}`)) {
      errors.push({ path: resolved, message: "This file type cannot be stored with a note" });
      return;
    }
    assets.push({
      sourcePath: resolved,
      filename,
      mimeType: fileMime(meta, resolved),
    });
  };

  const { masked } = maskCode(content);
  for (const match of masked.matchAll(/(!?\[[^\]\n]*\]\()([^)]+)\)/g)) {
    consider(splitDest(match[2] ?? "").href);
  }
  for (const match of masked.matchAll(/<(?:img|video|audio|source)\b[^>]*>/gi)) {
    const src = /\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')/i.exec(match[0] ?? "");
    if (src) consider(src[1] || src[2] || "");
  }
  for (const match of masked.matchAll(/^\s{0,3}\[([^\]]+)\]:\s+(\S+)/gm)) {
    consider(splitDest(match[2] ?? "").href);
  }
  for (const match of masked.matchAll(/!?\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g)) {
    consider(match[1] ?? "");
  }

  return { assets, errors };
}

/** Rewrite local asset links to the note's copied files. Failed uploads stay as they were. */
export function applyImportedAssets(
  content: string,
  sourcePath: string,
  noteId: string,
  assets: readonly PlannedAsset[],
): string {
  if (assets.length === 0) return content;
  const known = new Set(assets.map((asset) => asset.sourcePath));
  const bySource = new Map(assets.map((asset) => [asset.sourcePath, asset]));
  const swapFor = (href: string): UrlSwap | null => {
    const resolved = resolveLocalPath(sourcePath, href, known);
    const asset = resolved ? bySource.get(resolved) : undefined;
    if (!asset) return null;
    const filename = asset.filename;
    const kind = classifyPageFile({ name: filename, type: asset.mimeType });
    return {
      url: pageAssetMarkdownUrl(`${noteId}.md`, filename),
      kind,
      name: humanizeAssetFilename(filename, kind === "image" ? "image" : "file"),
    };
  };

  const { masked, blocks } = maskCode(content);
  let next = masked.replace(/(!?)\[([^\]\n]*)\]\(([^)]+)\)/g, (full, bang: string, alt: string, dest: string) => {
    const { href, suffix } = splitDest(dest);
    const swap = swapFor(href);
    if (!swap) return full;
    return `${bang}[${alt}](${swap.url}${suffix})`;
  });
  next = next.replace(/<(img|video|audio|source)\b([^>]*)>/gi, (full, tag: string, rest: string) => {
    const src = /\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')/i.exec(rest);
    const href = src?.[1] || src?.[2];
    if (!href) return full;
    const swap = swapFor(href);
    if (!swap) return full;
    const quote = src?.[1] ? '"' : "'";
    return `<${tag}${rest.replace(src![0], `src=${quote}${swap.url}${quote}`)}>`;
  });
  next = next.replace(/^(\s{0,3}\[[^\]]+\]:\s+)(\S+)(.*)$/gm, (full, prefix: string, dest: string, tail: string) => {
    const { href, suffix } = splitDest(dest);
    const swap = swapFor(href);
    if (!swap) return full;
    return `${prefix}${swap.url}${suffix}${tail}`;
  });
  next = next.replace(/(!?)\[\[([^\]|#]+)(\|[^\]]*)?\]\]/g, (full, bang: string, target: string, label: string | undefined) => {
    const swap = swapFor(target);
    if (!swap) return full;
    const alt = (label ? label.slice(1) : swap.name).trim() || swap.name;
    if (bang || swap.kind === "image" || swap.kind === "video" || swap.kind === "audio") {
      return markdownForAsset(swap, alt);
    }
    return `[${alt}](${swap.url})`;
  });
  return unmaskCode(next, blocks);
}

/** Give a heading-less file its filename as the sidebar label. */
export function ensureImportTitle(content: string, sourcePath: string): string {
  if (titleFromMarkdown(content) !== "Untitled") return content;
  const base = sourcePath.split("/").pop() ?? "Untitled";
  const stem = base.replace(/\.(?:md|markdown)$/i, "").trim() || "Untitled";
  return replaceMarkdownTitle(content, stem.slice(0, 200));
}

export function buildFolderPlan(markdownPaths: readonly string[]): PlannedFolder[] {
  const dirs = new Set<string>();
  for (const path of markdownPaths) {
    const parts = dirname(path).split("/").filter(Boolean);
    let acc = "";
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      dirs.add(acc);
    }
  }
  const sorted = [...dirs].sort(
    (a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b),
  );
  const byPath = new Map<string, PlannedFolder>();
  for (const dir of sorted) {
    const parts = dir.split("/");
    const name = (parts[parts.length - 1] ?? "untitled").trim().slice(0, 80) || "untitled";
    const parentPath = parts.slice(0, -1).join("/");
    byPath.set(dir, {
      id: crypto.randomUUID(),
      parentId: parentPath ? (byPath.get(parentPath)?.id ?? null) : null,
      name,
      sourcePath: dir,
    });
  }
  return [...byPath.values()];
}

export function parentFolderId(folders: readonly PlannedFolder[], markdownPath: string): string | null {
  const dir = dirname(markdownPath);
  if (!dir) return null;
  return folders.find((folder) => folder.sourcePath === dir)?.id ?? null;
}

/** Drop the directory the picker reports, so paths match `showDirectoryPicker` entries. */
export function relativeImportPath(webkitRelativePath: string): string | null {
  const parts = webkitRelativePath.split("/").filter(Boolean);
  if (parts.length > 1) parts.shift();
  if (parts.some((part) => SKIP_DIR_NAMES.has(part))) return null;
  const path = parts.join("/");
  return path || null;
}

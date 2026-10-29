import type { RootKey } from "@/lib/config";
import { fetchFile, fetchTree, type TreeNode } from "@/lib/search-io";
import { isMarkdownPath } from "@/lib/config";
import { flattenMarkdownPaths } from "./flatten-tree";
import type { RawDoc, SearchIndexEngine } from "./search-index-engine";

/** Build progress exposed to the UI while indexing. */
export type BuildProgress = {
  status: "idle" | "building" | "ready" | "error";
  indexed: number;
  total: number;
  error?: string;
};

const DEFAULT_CONCURRENCY = 8;
const DEFAULT_CHUNK_SIZE = 64;

/**
 * Rebuild the entire index from scratch for the given roots.
 *
 * Walks each root's tree, collects Markdown paths, fetches file contents with
 * bounded concurrency, and streams raw content to the engine in chunks so
 * normalization + MiniSearch work happens off the main thread. The engine is
 * reset before the build starts. `onProgress` is throttled to one update per
 * chunk so a large vault does not re-render the UI on every file.
 *
 * Pass a `signal` from the store's rebuild generation so a superseded build
 * stops writing to the engine instead of racing the newer one.
 */
export async function rebuildIndex(
  engine: SearchIndexEngine,
  roots: RootKey[],
  onProgress?: (progress: BuildProgress) => void,
  signal?: AbortSignal,
  concurrency = DEFAULT_CONCURRENCY,
  chunkSize = DEFAULT_CHUNK_SIZE,
): Promise<void> {
  onProgress?.({ status: "building", indexed: 0, total: 0 });
  try {
    await engine.reset();
    if (signal?.aborted) return;

    const trees = await Promise.all(
      roots.map((root) => fetchTree(root).catch(() => [] as TreeNode[])),
    );
    if (signal?.aborted) return;

    const plan: Array<{ root: RootKey; path: string }> = [];
    roots.forEach((root, i) => {
      for (const path of flattenMarkdownPaths(trees[i])) {
        plan.push({ root, path });
      }
    });
    onProgress?.({ status: "building", indexed: 0, total: plan.length });

    let done = 0;
    let chunk: RawDoc[] = [];
    await runWithConcurrency(plan, concurrency, async ({ root, path }) => {
      if (signal?.aborted) return;
      const raw = await fetchFile(root, path, { prefetchAssets: false }).catch(() => "");
      if (!raw) return;
      chunk.push({ root, path, raw });
      done += 1;
      if (chunk.length >= chunkSize) {
        if (signal?.aborted) return;
        await engine.addChunk(chunk);
        chunk = [];
        onProgress?.({ status: "building", indexed: done, total: plan.length });
      }
    });
    if (chunk.length > 0 && !signal?.aborted) {
      await engine.addChunk(chunk);
    }

    if (signal?.aborted) return;
    onProgress?.({ status: "ready", indexed: done, total: plan.length });
  } catch (error) {
    if (signal?.aborted) return;
    onProgress?.({
      status: "error",
      indexed: 0,
      total: 0,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Incrementally update a single file in the index after an fs event.
 *
 * `change`/`add` re-fetches and upserts raw content into the engine;
 * `unlink`/`unlinkDir` removes the document (and, for directory deletes, any
 * descendant paths).
 */
export async function handleFsEvent(
  engine: SearchIndexEngine,
  event: { event?: string; root?: RootKey; path?: string },
): Promise<void> {
  if (!event.root || !event.path) return;
  const root = event.root;
  const path = event.path;
  const type = event.event;

  if (type === "unlink" || type === "unlinkDir") {
    if (type === "unlinkDir") {
      await engine.removeDir(root, path);
    } else {
      await engine.removeFile(root, path);
    }
    return;
  }

  if (!isMarkdownPath(path)) return;
  const raw = await fetchFile(root, path, { prefetchAssets: false }).catch(() => null);
  if (raw == null) return;
  await engine.upsertRaw(root, path, raw);
}

/** Upsert raw content we already have (in-app save). */
export async function applyLocalSave(
  engine: SearchIndexEngine,
  root: RootKey,
  path: string,
  content: string,
): Promise<void> {
  if (!isMarkdownPath(path)) return;
  await engine.upsertRaw(root, path, content);
}

/** Remove a document after an in-app delete. */
export async function applyLocalDelete(
  engine: SearchIndexEngine,
  root: RootKey,
  path: string,
): Promise<void> {
  await engine.removeFile(root, path);
}

/** Re-index after an in-app move (search + recents). */
export async function applyLocalMove(
  engine: SearchIndexEngine,
  root: RootKey,
  oldPath: string,
  newPath: string,
  readMarkdown: (path: string) => Promise<string>,
): Promise<void> {
  await engine.removeFile(root, oldPath);
  await engine.removeDir(root, oldPath);
  if (/\.md$/i.test(newPath)) {
    try {
      const content = await readMarkdown(newPath);
      await engine.upsertRaw(root, newPath, content);
    } catch {
      // Tree refresh / fs events will catch up.
    }
  }
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor]!;
      cursor += 1;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

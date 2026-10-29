const ROOT = "import-jobs";

async function jobDirectory(jobId: string, create: boolean): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const base = await root.getDirectoryHandle(ROOT, { create: true });
  return base.getDirectoryHandle(jobId, { create });
}

async function nestedFile(
  jobId: string,
  kind: "notes" | "assets",
  relativePath: string,
  create: boolean,
): Promise<FileSystemFileHandle> {
  let dir = await jobDirectory(jobId, create);
  dir = await dir.getDirectoryHandle(kind, { create });
  const parts = relativePath.split("/").filter(Boolean);
  const name = parts.pop();
  if (!name) throw new Error("missing file name");
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
  return dir.getFileHandle(name, { create });
}

export async function writeImportText(jobId: string, relativePath: string, text: string): Promise<void> {
  const handle = await nestedFile(jobId, "notes", relativePath, true);
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

export async function writeImportBlob(jobId: string, relativePath: string, blob: Blob): Promise<void> {
  const handle = await nestedFile(jobId, "assets", relativePath, true);
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export async function importAssetExists(jobId: string, relativePath: string): Promise<boolean> {
  try {
    await nestedFile(jobId, "assets", relativePath, false);
    return true;
  } catch {
    return false;
  }
}

export async function readImportText(jobId: string, relativePath: string): Promise<string> {
  const handle = await nestedFile(jobId, "notes", relativePath, false);
  return (await handle.getFile()).text();
}

export async function readImportBlob(jobId: string, relativePath: string): Promise<Blob> {
  const handle = await nestedFile(jobId, "assets", relativePath, false);
  return handle.getFile();
}

export async function deleteImportFiles(jobId: string): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) return;
  const root = await navigator.storage.getDirectory();
  const base = await root.getDirectoryHandle(ROOT, { create: true });
  try {
    await base.removeEntry(jobId, { recursive: true });
  } catch {
    /* already gone */
  }
}

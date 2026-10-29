import { mimeTypeFromAssetFilename } from "@shared/page-assets";
import { relativeImportPath, SKIP_DIR_NAMES } from "@/lib/import-markdown";

export type PickedFile = {
  path: string;
  size: number;
  mimeType: string;
  read: () => Promise<Blob>;
};

function mimeFor(name: string, type: string): string {
  return type || mimeTypeFromAssetFilename(name);
}

export async function listHandleFiles(
  root: FileSystemDirectoryHandle,
  onPath: (path: string) => void,
): Promise<PickedFile[]> {
  const files: PickedFile[] = [];

  const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === "directory") {
        if (SKIP_DIR_NAMES.has(name)) continue;
        await walk(handle, prefix ? `${prefix}/${name}` : name);
        continue;
      }
      const path = prefix ? `${prefix}/${name}` : name;
      const fileHandle = handle;
      files.push({
        path,
        size: 0,
        mimeType: mimeFor(name, ""),
        read: async () => fileHandle.getFile(),
      });
      onPath(path);
    }
  };

  await walk(root, "");
  return files;
}

export function listInputFiles(list: FileList): PickedFile[] {
  const files: PickedFile[] = [];
  for (const file of list) {
    const path = relativeImportPath(file.webkitRelativePath || file.name);
    if (!path) continue;
    files.push({
      path,
      size: file.size,
      mimeType: mimeFor(path, file.type),
      read: async () => file,
    });
  }
  return files;
}

export function canPickDirectory(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

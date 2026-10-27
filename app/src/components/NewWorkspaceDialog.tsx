import { useEffect, useRef, useState } from "react";
import { FolderOpen } from "lucide-react";
import { observer } from "mobx-react-lite";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { canPickDirectory } from "@/lib/import-source";
import { importStore } from "@/stores/import-store";
import { syncStore } from "@/stores/sync-store";
import { workspaceStore } from "@/stores/workspace-store";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (workspaceId: string) => void;
};

type WorkspaceMode = "scratch" | "import";

export const NewWorkspaceDialog = observer(function NewWorkspaceDialog({ open, onOpenChange, onCreated }: Props) {
  const [mode, setMode] = useState<WorkspaceMode>("scratch");
  const [name, setName] = useState("");
  const [folderLabel, setFolderLabel] = useState<string | null>(null);
  const folderName = useRef("");
  const handleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const listRef = useRef<FileList | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => nameRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, mode]);

  const reset = () => {
    setMode("scratch");
    setName("");
    setFolderLabel(null);
    folderName.current = "";
    handleRef.current = null;
    listRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const close = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const rememberFolder = (label: string) => {
    setFolderLabel(label);
    setName((current) => (!current.trim() || current === folderName.current ? label : current));
    folderName.current = label;
  };

  const chooseFolder = async () => {
    if (canPickDirectory()) {
      try {
        const handle = await window.showDirectoryPicker({ mode: "read" });
        handleRef.current = handle;
        listRef.current = null;
        rememberFolder(handle.name);
      } catch {
        return;
      }
      return;
    }
    fileInputRef.current?.click();
  };

  const ready = syncStore.ready && !importStore.busy;

  const createEmpty = () => {
    const next = name.trim();
    if (!next || !ready) return;
    onCreated(workspaceStore.createWorkspace(next));
    close(false);
  };

  const importFolder = () => {
    const next = name.trim();
    if (!next || !ready) return;
    const handle = handleRef.current;
    const list = listRef.current;
    const workspaceId = handle
      ? importStore.startDirectory(next, handle)
      : list && list.length > 0
        ? importStore.startFileList(next, list)
        : null;
    if (!workspaceId) return;
    onCreated(workspaceId);
    close(false);
  };

  const folderReady = folderLabel !== null;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          nameRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>New workspace</DialogTitle>
        </DialogHeader>
        <Tabs value={mode} onValueChange={(value) => setMode(value as WorkspaceMode)}>
          <TabsList className="-mx-4 -mt-1 w-[calc(100%+2rem)]">
            <TabsTrigger value="scratch" className="flex-1">
              From scratch
            </TabsTrigger>
            <TabsTrigger value="import" className="flex-1 border-r-0">
              Import from folder
            </TabsTrigger>
          </TabsList>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (mode === "import") importFolder();
              else createEmpty();
            }}
          >
            <TabsContent value="scratch" className="mt-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="workspace-name">Name</Label>
                <Input
                  ref={nameRef}
                  id="workspace-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
            </TabsContent>
            <TabsContent value="import" className="mt-3 flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="workspace-import-name">Name</Label>
                <Input
                  ref={nameRef}
                  id="workspace-import-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" onClick={() => void chooseFolder()}>
                    <FolderOpen />
                    {folderLabel ? "Change folder" : "Choose folder"}
                  </Button>
                  {folderLabel ? <span className="min-w-0 truncate text-xs text-ink">{folderLabel}</span> : null}
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Import copies markdown files and the images, video, and other files they link to. It runs once, in the
                  background.
                </p>
              </div>
            </TabsContent>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              aria-hidden
              multiple
              tabIndex={-1}
              onChange={(event) => {
                const list = event.target.files;
                if (!list || list.length === 0) return;
                handleRef.current = null;
                listRef.current = list;
                const label = list[0]?.webkitRelativePath.split("/")[0] || "Folder";
                rememberFolder(label);
              }}
              {...{ webkitdirectory: "", directory: "" }}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                Cancel
              </Button>
              {mode === "import" ? (
                <Button type="submit" variant="default" disabled={!folderReady || !name.trim() || !ready}>
                  Import
                </Button>
              ) : (
                <Button type="submit" variant="default" disabled={!name.trim() || !ready}>
                  Create
                </Button>
              )}
            </DialogFooter>
          </form>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
});

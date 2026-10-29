import { useEffect, useState, type FormEvent } from "react";
import { observer } from "mobx-react-lite";

import { SettingsField, SettingsSectionShell } from "@/components/settings/SettingsSectionShell";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { workspaceStore } from "@/stores/workspace-store";

export const GeneralSettings = observer(function GeneralSettings({
  onWorkspaceDeleted,
}: {
  onWorkspaceDeleted?: (nextWorkspaceId: string | null) => void;
}) {
  const workspace = workspaceStore.activeWorkspace;
  const workspaceId = workspaceStore.activeId;
  const [name, setName] = useState(workspace?.name ?? "");
  const [nameMessage, setNameMessage] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [namePending, setNamePending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  useEffect(() => {
    setName(workspace?.name ?? "");
    setNameMessage(null);
    setNameError(null);
  }, [workspace?.id, workspace?.name]);

  if (!workspaceId || !workspace) {
    return (
      <SettingsSectionShell title="General" description="Settings for the active workspace.">
        <p className="text-sm text-dim">Open or create a workspace to edit its settings.</p>
      </SettingsSectionShell>
    );
  }

  const activeWorkspaceId = workspaceId;
  const canConfirmDelete = confirmName === workspace.name;

  async function saveName(event: FormEvent) {
    event.preventDefault();
    setNamePending(true);
    setNameMessage(null);
    setNameError(null);
    const error = await workspaceStore.renameWorkspace(activeWorkspaceId, name);
    setNamePending(false);
    if (error) {
      setNameError(error);
      return;
    }
    setNameMessage("Workspace name updated.");
  }

  async function confirmDelete() {
    if (!canConfirmDelete || deletePending) return;
    setDeletePending(true);
    setDeleteError(null);
    const { nextWorkspaceId, error } = await workspaceStore.deleteWorkspace(activeWorkspaceId);
    setDeletePending(false);
    if (error) {
      setDeleteError(error);
      return;
    }
    setDeleteOpen(false);
    setConfirmName("");
    onWorkspaceDeleted?.(nextWorkspaceId);
  }

  return (
    <>
      <SettingsSectionShell title="General" description="Settings for this workspace.">
        <form className="flex flex-col gap-3" onSubmit={saveName}>
          <SettingsField label="Workspace name" hint="Shown in the sidebar and workspace switcher.">
            <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
          </SettingsField>
          {nameError ? <p className="text-xs text-danger">{nameError}</p> : null}
          {nameMessage ? <p className="text-xs text-dim">{nameMessage}</p> : null}
          <div>
            <Button
              type="submit"
              size="sm"
              disabled={namePending || !name.trim() || name.trim() === workspace.name}
            >
              Save name
            </Button>
          </div>
        </form>

        <Card className="border-danger/40">
          <CardHeader>
            <CardTitle className="text-danger">Delete workspace</CardTitle>
            <CardDescription>
              Permanently delete <span className="font-medium text-ink">{workspace.name}</span>, including all notes,
              folders, images, and history. This cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
              Delete workspace
            </Button>
          </CardContent>
        </Card>
      </SettingsSectionShell>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) {
            setConfirmName("");
            setDeleteError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete workspace?</AlertDialogTitle>
            <AlertDialogDescription>
              Type <span className="font-medium text-ink">{workspace.name}</span> to confirm. All data in this workspace
              will be removed from this instance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={confirmName}
            onChange={(event) => setConfirmName(event.target.value)}
            placeholder={workspace.name}
            autoComplete="off"
            aria-label="Confirm workspace name"
          />
          {deleteError ? <p className="text-xs text-danger">{deleteError}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletePending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!canConfirmDelete || deletePending}
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
            >
              Delete workspace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});

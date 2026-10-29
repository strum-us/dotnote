import { History } from "lucide-react";
import { observer } from "mobx-react-lite";

import { Button } from "@/components/ui/button";
import { NoteHistoryDialog } from "@/components/tabs/NoteHistoryDialog";
import { noteStore } from "@/stores/note-store";

export const NoteHistoryButton = observer(function NoteHistoryButton({ workspaceId }: { workspaceId: string }) {
  const disabled = !noteStore.openNoteId || !noteStore.editorReady;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        disabled={disabled}
        aria-label="History"
        title="History"
        onClick={() => noteStore.setHistoryOpen(true)}
      >
        <History className="text-dim" />
      </Button>
      <NoteHistoryDialog workspaceId={workspaceId} />
    </>
  );
});

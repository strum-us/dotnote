import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  open: boolean;
  title: string;
  label: string;
  initial?: string;
  confirmLabel?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (value: string) => void;
};

export function NameDialog({ open, title, label, initial = "", confirmLabel = "Create", onOpenChange, onSubmit }: Props) {
  const [value, setValue] = useState(initial);

  useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const next = value.trim();
            if (!next) return;
            onSubmit(next);
            onOpenChange(false);
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="name-dialog-input">{label}</Label>
            <Input id="name-dialog-input" value={value} autoFocus onChange={(event) => setValue(event.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{confirmLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

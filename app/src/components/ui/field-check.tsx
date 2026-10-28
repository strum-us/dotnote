import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function FieldCheck({
  id,
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
  className,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start gap-2", className)}>
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        className="mt-0.5"
      />
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm text-ink">
          {label}
        </Label>
        {description ? <p className="mt-1 text-xs text-dim">{description}</p> : null}
      </div>
    </div>
  );
}

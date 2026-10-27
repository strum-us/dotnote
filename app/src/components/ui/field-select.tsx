
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface FieldSelectOption {
  value: string;
  label: string;
  /** Shown on the right in the dropdown only (not in the closed trigger). */
  detail?: string;
}

export function FieldSelect({
  value,
  onValueChange,
  options,
  placeholder = 'Select',
  disabled,
  className,
  'aria-label': ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: FieldSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <Select value={value || undefined} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className={cn('h-7 min-w-[7rem]', className)} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} detail={option.detail}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

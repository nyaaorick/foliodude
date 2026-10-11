import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { localToday } from '@/lib/utils/local-date';

/** A labelled form control. */
export function Field({
  label,
  htmlFor,
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

/** A value the user can see but not change. */
export function ReadOnlyValue({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Field label={label}>
      <div className="rounded-lg border border-input bg-muted/40 px-3 py-2 text-sm">
        {children}
      </div>
    </Field>
  );
}

export function PrefixedInput({
  prefix,
  prefixClassName = 'left-2.5',
  className,
  ...props
}: React.ComponentProps<'input'> & { prefix: string; prefixClassName?: string }) {
  return (
    <div className="relative">
      <span
        className={cn(
          'pointer-events-none absolute top-1/2 -translate-y-1/2 text-sm text-muted-foreground',
          prefixClassName,
        )}
      >
        {prefix}
      </span>
      <Input className={cn('pl-6', className)} {...props} />
    </div>
  );
}

export function MemoField({ placeholder }: { placeholder: string }) {
  return (
    <Field label="Memo (optional)" htmlFor="memo">
      <Input id="memo" name="memo" placeholder={placeholder} />
    </Field>
  );
}

/** Submits as `YYYY-MM-DD` under the name `date`, which is what the actions expect. */
export function DateField() {
  return (
    <Field label="Date" htmlFor="date">
      <Input id="date" name="date" type="date" required defaultValue={localToday()} />
    </Field>
  );
}

export interface Option {
  value: string;
  label: React.ReactNode;
  /** Shown in the closed select instead of `label` (e.g. a shorter form). */
  display?: React.ReactNode;
}

/** A single-choice select over `options`. An unmatched `value` shows the placeholder. */
export function OptionSelect({
  value,
  onChange,
  options,
  placeholder,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  id?: string;
}) {
  const selected = options.find((option) => option.value === value);

  return (
    <Select value={value} onValueChange={(next) => next && onChange(next)}>
      <SelectTrigger className="w-full" id={id}>
        <SelectValue placeholder={placeholder}>
          {selected ? (selected.display ?? selected.label) : null}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

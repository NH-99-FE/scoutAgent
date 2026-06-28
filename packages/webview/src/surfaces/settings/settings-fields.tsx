// ============================================================
// Settings Fields — 设置表单通用字段组件
// ============================================================

import { ChevronRight } from 'lucide-react';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const EMPTY_SELECT_VALUE = '__scout_settings_unset__';

export interface SettingsSelectOption<T extends string> {
  value: T;
  label: ReactNode;
}

export function SettingsField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      {children}
    </label>
  );
}

export function SettingsJsonField({
  label,
  value,
  disabled,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <SettingsField label={label}>
      <Textarea
        value={value}
        disabled={disabled}
        placeholder={placeholder ?? '{ }'}
        className="min-h-24 resize-y font-mono text-xs"
        onChange={(event) => onChange(event.target.value)}
      />
    </SettingsField>
  );
}

export function SettingsCheckField({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();

  return (
    <div className="group/field text-muted-foreground flex items-center gap-2 text-sm">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

export function SettingsSelectField<T extends string>({
  value,
  disabled,
  onChange,
  options,
}: {
  value: T;
  disabled: boolean;
  onChange: (value: T) => void;
  options: Array<SettingsSelectOption<T>>;
}) {
  const selectValue = toSelectValue(value);

  return (
    <Select
      value={selectValue}
      disabled={disabled}
      onValueChange={(nextValue) => onChange(fromSelectValue(nextValue) as T)}
    >
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectViewport>
          {options.map((option) => {
            const optionValue = toSelectValue(option.value);
            return (
              <SelectItem key={optionValue} value={optionValue}>
                {option.label}
              </SelectItem>
            );
          })}
        </SelectViewport>
      </SelectContent>
    </Select>
  );
}

export function SettingsAdvancedOptions({
  description,
  className,
  children,
}: {
  description: string;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn('grid gap-3', className)}>
      <div className="grid gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={open}
          className="aria-expanded:text-foreground h-auto w-fit justify-start gap-2 bg-transparent px-0 py-0 text-sm font-semibold hover:bg-transparent aria-expanded:bg-transparent dark:hover:bg-transparent"
          onClick={() => setOpen((current) => !current)}
        >
          <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />
          高级选项
        </Button>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
      <CollapsibleContent className="scout-settings-collapse-content">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

function toSelectValue(value: string): string {
  return value || EMPTY_SELECT_VALUE;
}

function fromSelectValue(value: string): string {
  return value === EMPTY_SELECT_VALUE ? '' : value;
}

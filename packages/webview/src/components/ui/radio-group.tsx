import * as React from 'react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn('grid w-full gap-2', className)}
      {...props}
    />
  );
}

type RadioGroupItemProps = React.ComponentProps<typeof RadioGroupPrimitive.Item> & {
  variant?: 'control' | 'option';
};

function RadioGroupItem({
  children,
  className,
  variant = 'control',
  ...props
}: RadioGroupItemProps) {
  const isOption = variant === 'option';

  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        isOption
          ? 'group/radio-group-item peer border-border bg-background/70 dark:bg-input/30 hover:bg-background dark:hover:bg-input/50 text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/40 data-[state=checked]:border-foreground/20 data-[state=checked]:bg-muted/60 data-[state=checked]:text-foreground dark:data-[state=checked]:bg-input/50 relative flex h-7 w-full min-w-0 cursor-pointer items-center gap-2 overflow-hidden rounded-md border px-2 text-left text-xs transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50'
          : 'group/radio-group-item peer border-input text-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-[state=checked]:border-primary relative grid aspect-square size-4 shrink-0 place-items-center rounded-full border outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3',
        className,
      )}
      {...props}
    >
      {isOption ? (
        children
      ) : (
        <RadioGroupPrimitive.Indicator
          data-slot="radio-group-indicator"
          className="pointer-events-none flex size-full items-center justify-center"
        >
          <span className="h-1/2 w-1/2 rounded-full bg-current" />
        </RadioGroupPrimitive.Indicator>
      )}
    </RadioGroupPrimitive.Item>
  );
}

export { RadioGroup, RadioGroupItem };

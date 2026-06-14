import * as React from 'react';

import { cn } from '@/lib/utils';

function Textarea({
  className,
  onBlur,
  onPointerDown,
  ...props
}: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'border-input placeholder:text-muted-foreground disabled:bg-input/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 flex field-sizing-content min-h-16 w-full rounded-lg border bg-transparent px-2.5 py-2 text-base transition-colors outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3 md:text-sm',
        className,
      )}
      onBlur={(event) => {
        event.currentTarget.removeAttribute('data-scout-pointer-focus');
        onBlur?.(event);
      }}
      onPointerDown={(event) => {
        event.currentTarget.setAttribute('data-scout-pointer-focus', 'true');
        onPointerDown?.(event);
      }}
      {...props}
    />
  );
}

export { Textarea };

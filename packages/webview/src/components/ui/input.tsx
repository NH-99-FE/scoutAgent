import * as React from 'react';

import { cn } from '@/lib/utils';
import { clearPointerFocus, markPointerFocus } from './focus';

function Input({
  className,
  onBlur,
  onPointerDown,
  type,
  ...props
}: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'border-input bg-field-background file:text-foreground placeholder:text-muted-foreground disabled:bg-field-disabled aria-invalid:border-invalid-border aria-invalid:ring-invalid-ring h-8 w-full min-w-0 rounded-lg border px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3 md:text-sm',
        className,
      )}
      onBlur={(event) => {
        clearPointerFocus(event);
        onBlur?.(event);
      }}
      onPointerDown={(event) => {
        markPointerFocus(event);
        onPointerDown?.(event);
      }}
      {...props}
    />
  );
}

export { Input };

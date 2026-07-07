import * as React from 'react';

import { cn } from '@/lib/utils';
import { clearPointerFocus, markPointerFocus } from './focus';

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
        'scout-native-scrollbar border-input bg-field-background placeholder:text-muted-foreground disabled:bg-field-disabled aria-invalid:border-invalid-border aria-invalid:ring-invalid-ring flex field-sizing-content min-h-16 w-full rounded-lg border px-2.5 py-2 text-base transition-colors outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3 md:text-sm',
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

export { Textarea };

// ============================================================
// Icon Button — 带提示的通用图标按钮
// ============================================================

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface IconButtonProps {
  label: string;
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}

export function IconButton({ label, children, disabled, onClick }: IconButtonProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={label}
            disabled={disabled}
            size="icon-sm"
            type="button"
            variant="ghost"
            onClick={onClick}
          >
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

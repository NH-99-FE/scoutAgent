// ============================================================
// Icon Button — 带提示的通用图标按钮
// ============================================================

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

type IconButtonSize = 'icon-xs' | 'icon-sm' | 'icon' | 'icon-lg';

interface IconButtonProps {
  label: string;
  children: ReactNode;
  disabled?: boolean;
  size?: IconButtonSize;
  onClick?: () => void;
}

export function IconButton({ label, children, disabled, size = 'icon-sm', onClick }: IconButtonProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={label}
            disabled={disabled}
            size={size}
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

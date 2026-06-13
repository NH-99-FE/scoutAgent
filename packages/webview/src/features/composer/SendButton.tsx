// ============================================================
// Send Button — 发送与停止按钮
// ============================================================

import type { ReactNode } from 'react';
import { ArrowUp, CornerDownLeft, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface SendButtonProps {
  canSubmit: boolean;
  canStop: boolean;
  confirmAbort?: boolean;
  showStop: boolean;
  showStreamingSendTooltip?: boolean;
  onStop: () => void;
}

export function SendButton({
  canSubmit,
  canStop,
  confirmAbort = false,
  showStop,
  showStreamingSendTooltip = false,
  onStop,
}: SendButtonProps) {
  const button = (
    <Button
      aria-label={confirmAbort ? '确认中断' : showStop ? '停止' : '发送'}
      className="rounded-full"
      disabled={showStop ? !canStop : !canSubmit}
      size="icon-sm"
      type={showStop ? 'button' : 'submit'}
      variant="default"
      onClick={showStop ? onStop : undefined}
    >
      {showStop ? (
        confirmAbort ? (
          <span className="text-[10px] leading-none font-semibold">Esc</span>
        ) : (
          <Square className="size-2.5 fill-current stroke-current" strokeWidth={3} />
        )
      ) : (
        <ArrowUp />
      )}
    </Button>
  );

  if (!showStreamingSendTooltip || showStop) {
    return button;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent align="end" className="grid min-w-24 gap-1 px-2 py-1.5">
          <ShortcutRow label="队列" shortcut={<EnterKey />} />
          <ShortcutRow label="引导" shortcut={<SteerKey />} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function ShortcutRow({ label, shortcut }: { label: string; shortcut: ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-4">
      <span>{label}</span>
      {shortcut}
    </div>
  );
}

function EnterKey() {
  return (
    <span
      aria-label="Enter"
      className="bg-muted text-muted-foreground inline-flex h-5 min-w-7 items-center justify-center rounded-full px-1.5"
      data-slot="kbd"
    >
      <CornerDownLeft className="size-3" />
    </span>
  );
}

function SteerKey() {
  return (
    <span
      aria-label={`${getModifierKeyLabel()} Enter`}
      className="bg-muted text-muted-foreground inline-flex h-5 items-center gap-0.5 rounded-full px-1.5 text-[11px] leading-none"
      data-slot="kbd"
    >
      <span>{getModifierKeyLabel()}+</span>
      <CornerDownLeft className="size-3" />
    </span>
  );
}

function getModifierKeyLabel(): string {
  if (typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)) {
    return 'Cmd';
  }
  return 'Ctrl';
}

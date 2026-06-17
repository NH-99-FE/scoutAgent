// ============================================================
// Model Status Menu — 当前模型与思考等级入口
// ============================================================

import { ChevronDown, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCurrentModelLabel, useThinkingLevel } from '@/store/session-store';

export function ModelStatusMenu() {
  const model = useCurrentModelLabel();
  const thinkingLevel = useThinkingLevel();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className="text-muted-foreground max-w-36 min-w-0 shrink"
          size="sm"
          type="button"
          variant="ghost"
        >
          <Zap />
          <span className="min-w-0 truncate">{formatModelLabel(model)}</span>
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem disabled>{model || 'No model'}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>Thinking: {thinkingLevel}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function formatModelLabel(model: string): string {
  if (!model) return '模型';
  const parts = model.split('/').map((part) => part.trim());
  return parts.at(-1) || model;
}

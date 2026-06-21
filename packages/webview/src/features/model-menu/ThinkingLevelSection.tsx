// ============================================================
// Thinking Level Section — 推理强度菜单分区
// ============================================================

import { useMemo } from 'react';
import { protocolClient } from '@/bridge/protocol-client';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import {
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import type { ScoutModelInfo, ThinkingLevel } from '@scout-agent/shared';
import { getThinkingOptions } from './model-menu-options';

interface ThinkingLevelSectionProps {
  activeModel: ScoutModelInfo | undefined;
  hasCurrentModel: boolean;
  localThinkingChoicesOpen: boolean | null;
  onLocalThinkingChoicesOpenChange: (open: boolean) => void;
  thinkingLevel: ThinkingLevel;
}

export function ThinkingLevelSection({
  activeModel,
  hasCurrentModel,
  localThinkingChoicesOpen,
  onLocalThinkingChoicesOpenChange,
  thinkingLevel,
}: ThinkingLevelSectionProps) {
  const thinkingOptions = useMemo(() => getThinkingOptions(activeModel), [activeModel]);
  const hasThinkingChoices = thinkingOptions.length > 0;
  const supportsThinkingOff = activeModel?.supportedThinkingLevels.includes('off') ?? false;
  const runtimeThinkingEnabled =
    hasThinkingChoices && (!supportsThinkingOff || thinkingLevel !== 'off');
  const thinkingChoicesOpen =
    hasThinkingChoices &&
    (!supportsThinkingOff || (localThinkingChoicesOpen ?? runtimeThinkingEnabled));
  const canToggleThinking = hasThinkingChoices && supportsThinkingOff;
  const selectedThinkingLevel =
    runtimeThinkingEnabled && thinkingOptions.some((option) => option.level === thinkingLevel)
      ? thinkingLevel
      : '';

  const handleThinkingToggle = (checked: boolean) => {
    if (!canToggleThinking) return;
    onLocalThinkingChoicesOpenChange(checked);
    if (!checked) protocolClient.selectThinking('off');
  };

  if (!hasThinkingChoices) {
    return (
      <DropdownMenuItem className="h-7 pr-7 pl-2 text-xs" disabled>
        {hasCurrentModel && !activeModel ? '当前模型不可用' : '当前模型不支持推理'}
      </DropdownMenuItem>
    );
  }

  return (
    <>
      <div className="flex h-7 items-center px-2 text-xs">
        <span className="text-muted-foreground min-w-0 flex-1">推理</span>
        <Switch
          aria-label="推理"
          checked={thinkingChoicesOpen}
          className="ml-2"
          disabled={!canToggleThinking}
          onCheckedChange={handleThinkingToggle}
          size="sm"
        />
      </div>
      <Collapsible open={thinkingChoicesOpen}>
        <CollapsibleContent className="scout-process-collapse-content">
          <DropdownMenuRadioGroup
            value={selectedThinkingLevel}
            onValueChange={(level) => {
              const option = thinkingOptions.find((item) => item.level === level);
              if (option) protocolClient.selectThinking(option.level);
            }}
          >
            {thinkingOptions.map((option) => (
              <DropdownMenuRadioItem
                className="h-7 pr-7 pl-2 text-xs"
                key={option.level}
                value={option.level}
              >
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}

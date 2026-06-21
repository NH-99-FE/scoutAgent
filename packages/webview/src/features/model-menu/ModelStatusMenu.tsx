// ============================================================
// Model Status Menu — 当前模型与推理强度选择入口
// ============================================================

import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  useAvailableModels,
  useDefaultModelId,
  useDefaultModelProvider,
} from '@/store/config-store';
import {
  useCurrentModelId,
  useCurrentModelLabel,
  useCurrentModelProvider,
  useThinkingLevel,
} from '@/store/session-store';
import { ModelListSection } from './ModelListSection';
import { ThinkingLevelSection } from './ThinkingLevelSection';
import {
  formatModelLabel,
  formatModelName,
  getModelValue,
  resolveActiveModel,
} from './model-menu-options';

export function ModelStatusMenu() {
  const currentModelLabel = useCurrentModelLabel();
  const currentProvider = useCurrentModelProvider();
  const currentModelId = useCurrentModelId();
  const hasCurrentModel = Boolean(currentProvider || currentModelId);
  const thinkingLevel = useThinkingLevel();
  const models = useAvailableModels();
  const defaultProvider = useDefaultModelProvider();
  const defaultModelId = useDefaultModelId();
  const [modelsExpanded, setModelsExpanded] = useState(false);
  const [localThinkingChoicesOpen, setLocalThinkingChoicesOpen] = useState<{
    activeModelValue: string;
    thinkingLevel: string;
    open: boolean;
  } | null>(null);
  const activeModel = useMemo(
    () =>
      resolveActiveModel({
        models,
        currentProvider,
        currentModelId,
        defaultProvider,
        defaultModelId,
      }),
    [models, currentProvider, currentModelId, defaultProvider, defaultModelId],
  );
  const activeModelValue = activeModel ? getModelValue(activeModel) : '';
  const menuModelLabel = activeModel
    ? formatModelName(activeModel)
    : formatModelLabel(currentModelLabel || defaultModelId || defaultProvider);

  const resolvedLocalThinkingChoicesOpen =
    localThinkingChoicesOpen?.activeModelValue === activeModelValue &&
    localThinkingChoicesOpen.thinkingLevel === thinkingLevel
      ? localThinkingChoicesOpen.open
      : null;

  const handleLocalThinkingChoicesOpenChange = (open: boolean) => {
    setLocalThinkingChoicesOpen({ activeModelValue, thinkingLevel, open });
  };

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) setModelsExpanded(false);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="选择模型和推理强度"
          className="text-muted-foreground max-w-36 min-w-0 shrink rounded-full"
          size="sm"
          type="button"
          variant="ghost"
        >
          <span className="min-w-0 truncate">{menuModelLabel}</span>
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="bg-background text-foreground w-52 rounded-lg p-2 shadow-sm"
      >
        <ThinkingLevelSection
          activeModel={activeModel}
          hasCurrentModel={hasCurrentModel}
          localThinkingChoicesOpen={resolvedLocalThinkingChoicesOpen}
          onLocalThinkingChoicesOpenChange={handleLocalThinkingChoicesOpenChange}
          thinkingLevel={thinkingLevel}
        />

        <DropdownMenuSeparator className="mx-2 my-1.5" />

        <ModelListSection
          activeModelValue={activeModelValue}
          menuModelLabel={menuModelLabel}
          models={models}
          modelsExpanded={modelsExpanded}
          onModelsExpandedChange={setModelsExpanded}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

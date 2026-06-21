// ============================================================
// Model List Section — 模型选择菜单分区
// ============================================================

import type { Dispatch, SetStateAction } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { protocolClient } from '@/bridge/protocol-client';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ScoutModelInfo } from '@scout-agent/shared';
import {
  MAX_MODEL_LIST_HEIGHT_PX,
  MODEL_OPTION_HEIGHT_PX,
  formatModelName,
  getModelValue,
} from './model-menu-options';

interface ModelListSectionProps {
  activeModelValue: string;
  menuModelLabel: string;
  models: ScoutModelInfo[];
  modelsExpanded: boolean;
  onModelsExpandedChange: Dispatch<SetStateAction<boolean>>;
}

export function ModelListSection({
  activeModelValue,
  menuModelLabel,
  models,
  modelsExpanded,
  onModelsExpandedChange,
}: ModelListSectionProps) {
  const modelListHeight = Math.min(
    models.length * MODEL_OPTION_HEIGHT_PX,
    MAX_MODEL_LIST_HEIGHT_PX,
  );
  const modelListScrollable = models.length * MODEL_OPTION_HEIGHT_PX > MAX_MODEL_LIST_HEIGHT_PX;

  return (
    <Collapsible open={modelsExpanded}>
      <DropdownMenuItem
        aria-expanded={modelsExpanded}
        className="h-7 pr-7 pl-2 text-xs"
        onSelect={(event) => {
          event.preventDefault();
          onModelsExpandedChange((expanded) => !expanded);
        }}
      >
        <span className="min-w-0 flex-1 truncate">{menuModelLabel}</span>
        {modelsExpanded ? (
          <ChevronDown className="text-muted-foreground size-4" />
        ) : (
          <ChevronRight className="text-muted-foreground size-4" />
        )}
      </DropdownMenuItem>

      <CollapsibleContent className="scout-process-collapse-content">
        <DropdownMenuLabel className="px-2 pt-1.5 pb-0.5 text-xs">模型</DropdownMenuLabel>
        <div className="relative">
          <ScrollArea
            className="pr-1"
            style={{ height: modelListHeight }}
            viewportClassName="h-full"
          >
            <DropdownMenuRadioGroup
              value={activeModelValue}
              onValueChange={(value) => {
                const model = models.find((item) => getModelValue(item) === value);
                if (!model) return;
                protocolClient.selectModel(model.provider, model.id);
              }}
            >
              {models.map((model) => (
                <DropdownMenuRadioItem
                  className="h-7 pr-7 pl-2 text-xs"
                  key={getModelValue(model)}
                  value={getModelValue(model)}
                >
                  <span className="min-w-0 truncate">{formatModelName(model)}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </ScrollArea>
          {modelListScrollable ? (
            <div
              aria-hidden="true"
              className="from-background pointer-events-none absolute inset-x-0 top-0 h-2 bg-linear-to-b to-transparent"
            />
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

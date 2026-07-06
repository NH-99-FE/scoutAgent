// ============================================================
// Slash Command Menu — Composer 命令候选面板
// ============================================================

import { cn } from '@/lib/utils';
import { ComposerFloatingPanel, ComposerFloatingPanelHint } from './ComposerFloatingPanel';
import type { SlashCommandMenuItem } from '../model/slash-command-options';

interface SlashCommandMenuProps {
  activeIndex: number;
  items: SlashCommandMenuItem[];
  onSelect: (item: SlashCommandMenuItem) => void;
}

// ---------- Component ----------

export function SlashCommandMenu({ activeIndex, items, onSelect }: SlashCommandMenuProps) {
  if (items.length === 0) {
    return (
      <ComposerFloatingPanelHint label="Slash commands">没有匹配的命令</ComposerFloatingPanelHint>
    );
  }

  return (
    <ComposerFloatingPanel label="Slash commands">
      {items.map((item, index) => (
        <SlashCommandMenuRow
          active={index === activeIndex}
          item={item}
          key={item.key}
          onSelect={onSelect}
        />
      ))}
    </ComposerFloatingPanel>
  );
}

function SlashCommandMenuRow({
  active,
  item,
  onSelect,
}: {
  active: boolean;
  item: SlashCommandMenuItem;
  onSelect: (item: SlashCommandMenuItem) => void;
}) {
  const Icon = item.icon;

  return (
    <button
      aria-selected={active}
      className={cn(
        'flex h-8 w-full items-center gap-1 rounded-lg px-2 text-left text-xs outline-hidden',
        active ? 'bg-muted dark:bg-muted/50' : 'hover:bg-muted dark:hover:bg-muted/50',
      )}
      role="option"
      type="button"
      onClick={() => onSelect(item)}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
    >
      <Icon className="text-foreground/90 size-4 shrink-0" />
      <span className="text-foreground/90 shrink-0 truncate font-medium">{item.label}</span>
      <span className="text-muted-foreground min-w-0 flex-1 truncate">{item.description}</span>
    </button>
  );
}

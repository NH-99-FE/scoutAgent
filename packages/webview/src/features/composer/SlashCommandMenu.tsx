// ============================================================
// Slash Command Menu — Composer 命令候选面板
// ============================================================

import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { SlashCommandMenuItem } from './slash-command-options';

interface SlashCommandMenuProps {
  activeIndex: number;
  items: SlashCommandMenuItem[];
  onSelect: (item: SlashCommandMenuItem) => void;
}

// ---------- Component ----------

export function SlashCommandMenu({ activeIndex, items, onSelect }: SlashCommandMenuProps) {
  if (items.length === 0) {
    return (
      <div
        aria-label="Slash commands"
        className="border-border bg-background text-muted-foreground mb-1.5 max-h-[min(280px,42vh)] overflow-hidden rounded-xl border px-3 py-2 text-xs shadow-sm"
        role="listbox"
      >
        没有匹配的命令
      </div>
    );
  }

  return (
    <div
      aria-label="Slash commands"
      className="border-border bg-background mb-1.5 overflow-hidden rounded-xl border shadow-sm"
      role="listbox"
    >
      <ScrollArea className="max-h-[min(280px,42vh)]" viewportClassName="max-h-[min(280px,42vh)]">
        <div className="p-1.5">
          {items.map((item, index) => (
            <SlashCommandMenuRow
              active={index === activeIndex}
              item={item}
              key={item.key}
              onSelect={onSelect}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
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

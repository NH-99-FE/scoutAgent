// ============================================================
// Slash Command Menu — Composer 命令候选面板
// ============================================================

import { Fragment } from 'react';
import { FloatingPanel } from '@/components/common/FloatingPanel';
import { cn } from '@/lib/utils';
import { useSuggestionOptionScroll } from '../hooks/use-suggestion-option-scroll';
import type { SlashCommandMenuItem } from '../model/slash-command-options';

interface SlashCommandMenuProps {
  activeIndex: number;
  items: SlashCommandMenuItem[];
  onHover: (index: number) => void;
  onSelect: (item: SlashCommandMenuItem) => void;
}

// ---------- Component ----------

export function SlashCommandMenu({ activeIndex, items, onHover, onSelect }: SlashCommandMenuProps) {
  const activeKey = items[activeIndex]?.key ?? null;
  const skillStartIndex = items.findIndex((item) => item.command.source === 'skill');
  const { setOptionElement } = useSuggestionOptionScroll(activeKey);

  if (items.length === 0) {
    return (
      <FloatingPanel
        aria-label="Slash commands"
        className="text-muted-foreground text-xs"
        contentClassName="px-3 py-2"
        role="status"
        scrollable={false}
      >
        没有匹配的命令
      </FloatingPanel>
    );
  }

  return (
    <FloatingPanel aria-label="Slash commands" role="listbox">
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {index === skillStartIndex ? <SlashCommandMenuSection /> : null}
          <SlashCommandMenuRow
            active={index === activeIndex}
            item={item}
            optionRef={(element) => setOptionElement(item.key, element)}
            onHover={() => onHover(index)}
            onSelect={onSelect}
          />
        </Fragment>
      ))}
    </FloatingPanel>
  );
}

function SlashCommandMenuSection() {
  return (
    <div
      aria-hidden="true"
      className="text-foreground/60 px-2 py-0.5 text-[11px] leading-4"
      role="presentation"
    >
      技能
    </div>
  );
}

function SlashCommandMenuRow({
  active,
  item,
  optionRef,
  onHover,
  onSelect,
}: {
  active: boolean;
  item: SlashCommandMenuItem;
  optionRef: (element: HTMLButtonElement | null) => void;
  onHover: () => void;
  onSelect: (item: SlashCommandMenuItem) => void;
}) {
  const Icon = item.icon;

  return (
    <button
      ref={optionRef}
      aria-selected={active}
      className={cn(
        'group/slash-command-row flex h-7 w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-md px-2 text-left text-xs outline-hidden',
        active ? 'bg-control-selected' : 'hover:bg-control-hover',
      )}
      role="option"
      type="button"
      onClick={() => onSelect(item)}
      onMouseEnter={onHover}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
    >
      <Icon
        className={cn(
          'size-3.5 shrink-0 transition-colors',
          active
            ? 'text-foreground/80'
            : 'text-foreground/65 group-hover/slash-command-row:text-foreground/80',
        )}
      />
      <span
        className={cn(
          'max-w-[58%] min-w-0 shrink truncate font-medium transition-colors',
          active
            ? 'text-foreground/90'
            : 'text-foreground/75 group-hover/slash-command-row:text-foreground/90',
        )}
      >
        {item.label}
      </span>
      <span
        className={cn(
          'w-0 min-w-0 flex-1 truncate transition-colors',
          active
            ? 'text-foreground/70'
            : 'text-muted-foreground/80 group-hover/slash-command-row:text-foreground/70',
        )}
        title={item.description}
      >
        {item.description}
      </span>
    </button>
  );
}

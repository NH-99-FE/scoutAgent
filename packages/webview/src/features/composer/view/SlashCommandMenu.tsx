// ============================================================
// Slash Command Menu — Composer 命令候选面板
// ============================================================

import { Fragment } from 'react';
import { cn } from '@/lib/utils';
import { ComposerFloatingPanel, ComposerFloatingPanelHint } from './ComposerFloatingPanel';
import { useComposerFloatingPanelOptionScroll } from './composer-floating-panel-scroll';
import type { SlashCommandMenuItem } from '../model/slash-command-options';

interface SlashCommandMenuProps {
  activeIndex: number;
  items: SlashCommandMenuItem[];
  onSelect: (item: SlashCommandMenuItem) => void;
}

// ---------- Component ----------

export function SlashCommandMenu({ activeIndex, items, onSelect }: SlashCommandMenuProps) {
  const activeKey = items[activeIndex]?.key ?? null;
  const skillStartIndex = items.findIndex((item) => item.command.source === 'skill');
  const { setOptionElement } = useComposerFloatingPanelOptionScroll(activeKey);

  if (items.length === 0) {
    return (
      <ComposerFloatingPanelHint label="Slash commands">没有匹配的命令</ComposerFloatingPanelHint>
    );
  }

  return (
    <ComposerFloatingPanel label="Slash commands">
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {index === skillStartIndex ? <SlashCommandMenuSection /> : null}
          <SlashCommandMenuRow
            active={index === activeIndex}
            item={item}
            optionRef={(element) => setOptionElement(item.key, element)}
            onSelect={onSelect}
          />
        </Fragment>
      ))}
    </ComposerFloatingPanel>
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
  onSelect,
}: {
  active: boolean;
  item: SlashCommandMenuItem;
  optionRef: (element: HTMLButtonElement | null) => void;
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

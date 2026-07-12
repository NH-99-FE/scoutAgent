// ============================================================
// Slash Command Menu — Composer 命令候选面板
// ============================================================

import { FloatingPanel } from '@/components/common/FloatingPanel';
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
  const primaryItems = skillStartIndex === -1 ? items : items.slice(0, skillStartIndex);
  const skillItems = skillStartIndex === -1 ? [] : items.slice(skillStartIndex);
  const { setOptionElement } = useSuggestionOptionScroll(activeKey);

  const renderRow = (item: SlashCommandMenuItem, index: number) => {
    const Icon = item.icon;
    return (
      <FloatingPanel.Option
        ref={(element) => setOptionElement(item.key, element)}
        key={item.key}
        active={index === activeIndex}
        description={item.description}
        icon={<Icon />}
        label={item.label}
        onClick={() => onSelect(item)}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => onHover(index)}
      />
    );
  };

  if (items.length === 0) {
    return (
      <FloatingPanel
        aria-label="Slash commands"
        className="text-muted-foreground text-xs"
        contentClassName="px-3 py-2"
        role="status"
        variant="status"
      >
        没有匹配的命令
      </FloatingPanel>
    );
  }

  return (
    <FloatingPanel aria-label="Slash commands" role="listbox">
      {primaryItems.map(renderRow)}
      {skillItems.length > 0 ? (
        <FloatingPanel.Group label="技能">
          {skillItems.map((item, index) => renderRow(item, skillStartIndex + index))}
        </FloatingPanel.Group>
      ) : null}
    </FloatingPanel>
  );
}

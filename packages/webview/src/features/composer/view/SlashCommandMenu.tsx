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
  const primaryItems = items.filter(
    (item) => item.command.source !== 'prompt' && item.command.source !== 'skill',
  );
  const promptItems = items.filter((item) => item.command.source === 'prompt');
  const skillItems = items.filter((item) => item.command.source === 'skill');
  const { setOptionElement } = useSuggestionOptionScroll(activeKey);

  const renderRow = (item: SlashCommandMenuItem) => {
    const index = items.indexOf(item);
    const Icon = item.icon;
    return (
      <FloatingPanel.Option
        ref={(element) => setOptionElement(item.key, element)}
        key={item.key}
        active={index === activeIndex}
        argumentHint={item.argumentHint}
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
      {promptItems.length > 0 ? (
        <FloatingPanel.Group label="提示词">{promptItems.map(renderRow)}</FloatingPanel.Group>
      ) : null}
      {skillItems.length > 0 ? (
        <FloatingPanel.Group label="技能">{skillItems.map(renderRow)}</FloatingPanel.Group>
      ) : null}
    </FloatingPanel>
  );
}

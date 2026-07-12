// ============================================================
// File Mention Search Menu — Composer @ 文件搜索候选
// ============================================================

import { File, Folder } from 'lucide-react';
import type { ScoutFileMentionItem } from '@scout-agent/shared';
import { FloatingPanel } from '@/components/common/FloatingPanel';
import { useSuggestionOptionScroll } from '../hooks/use-suggestion-option-scroll';

interface FileMentionSearchMenuProps {
  activeIndex: number;
  error?: string;
  items: ScoutFileMentionItem[];
  loading: boolean;
  onHover: (index: number) => void;
  onSelect: (item: ScoutFileMentionItem) => void;
}

export function FileMentionSearchMenu({
  activeIndex,
  error,
  items,
  loading,
  onHover,
  onSelect,
}: FileMentionSearchMenuProps) {
  const activeKey = items[activeIndex]?.id ?? null;
  const { setOptionElement } = useSuggestionOptionScroll(activeKey);

  if (loading || error || items.length === 0) {
    return (
      <FloatingPanel
        aria-label="文件搜索"
        className="text-muted-foreground text-xs"
        contentClassName="px-4 py-3"
        role="status"
        variant="status"
      >
        {loading ? '搜索中' : (error ?? '无结果')}
      </FloatingPanel>
    );
  }

  return (
    <FloatingPanel aria-label="文件搜索" role="listbox">
      {items.map((item, index) => (
        <FloatingPanel.Option
          ref={(element) => setOptionElement(item.id, element)}
          key={item.id}
          active={index === activeIndex}
          description={item.description}
          icon={item.kind === 'directory' ? <Folder /> : <File />}
          label={item.label}
          onClick={() => onSelect(item)}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => onHover(index)}
        />
      ))}
    </FloatingPanel>
  );
}

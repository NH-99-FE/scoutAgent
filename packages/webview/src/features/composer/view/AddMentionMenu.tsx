// ============================================================
// Add Mention Menu — Composer @ 添加菜单
// ============================================================

import { Folder, Paperclip } from 'lucide-react';
import { FloatingPanel } from '@/components/common/FloatingPanel';

interface AddMentionMenuProps {
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (selectionKind: 'file' | 'directory') => void;
}

export function AddMentionMenu({ activeIndex, onHover, onSelect }: AddMentionMenuProps) {
  return (
    <FloatingPanel aria-label="添加内容" contentClassName="px-1 py-1.5" role="listbox">
      <FloatingPanel.Group label="添加">
        <FloatingPanel.Option
          active={activeIndex === 0}
          icon={<Paperclip />}
          label="文件 / 图片"
          onClick={() => onSelect('file')}
          onMouseEnter={() => onHover(0)}
          onMouseDown={(event) => event.preventDefault()}
        />
        <FloatingPanel.Option
          active={activeIndex === 1}
          icon={<Folder />}
          label="文件夹"
          onClick={() => onSelect('directory')}
          onMouseEnter={() => onHover(1)}
          onMouseDown={(event) => event.preventDefault()}
        />
      </FloatingPanel.Group>
    </FloatingPanel>
  );
}

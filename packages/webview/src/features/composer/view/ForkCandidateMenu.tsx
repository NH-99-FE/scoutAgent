// ============================================================
// Fork Candidate Menu — Composer 历史消息分叉候选面板
// 与 SlashCommandMenu 同款底部浮层样式，替代居中弹窗以规避 webview 性能问题。
// 数据源为当前 session raw entries，不受压缩展示投影影响。
// ============================================================

import { useEffect, useRef } from 'react';
import { Split } from 'lucide-react';
import type { ScoutForkCandidate } from '@scout-agent/shared';
import { cn } from '@/lib/utils';
import { ComposerFloatingPanel, ComposerFloatingPanelHint } from './ComposerFloatingPanel';

interface ForkCandidateMenuProps {
  activeIndex: number;
  // null 表示候选尚在拉取中
  candidates: ScoutForkCandidate[] | null;
  onHover: (index: number) => void;
  onSelect: (index: number) => void;
}

// ---------- Component ----------

export function ForkCandidateMenu({
  activeIndex,
  candidates,
  onHover,
  onSelect,
}: ForkCandidateMenuProps) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // 选中项滚动进视野
  useEffect(() => {
    optionRefs.current[activeIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  if (candidates === null) {
    return (
      <ComposerFloatingPanelHint label="Fork candidates">加载历史消息…</ComposerFloatingPanelHint>
    );
  }
  if (candidates.length === 0) {
    return (
      <ComposerFloatingPanelHint label="Fork candidates">
        当前会话没有可分叉的历史消息
      </ComposerFloatingPanelHint>
    );
  }

  return (
    <ComposerFloatingPanel label="Fork candidates">
      {candidates.map((candidate, index) => (
        <button
          key={candidate.entryId}
          ref={(el) => {
            optionRefs.current[index] = el;
          }}
          aria-selected={index === activeIndex}
          className={cn(
            'flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs outline-hidden',
            index === activeIndex ? 'bg-control-selected' : 'hover:bg-control-hover',
          )}
          role="option"
          type="button"
          onClick={() => onSelect(index)}
          onMouseEnter={() => onHover(index)}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
        >
          <Split className="text-foreground/90 mt-0.5 size-4 shrink-0 self-start" />
          <span className="text-foreground/90 line-clamp-2 min-w-0 flex-1 break-words whitespace-pre-wrap">
            {candidate.text.trim() || '（空消息）'}
          </span>
        </button>
      ))}
    </ComposerFloatingPanel>
  );
}

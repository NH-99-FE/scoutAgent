// ============================================================
// Skeleton — 通用骨架占位基础组件
// ============================================================

import type { CSSProperties } from 'react';

interface SkeletonBlockProps {
  className: string;
  style?: CSSProperties;
}

export function SkeletonBlock({ className, style }: SkeletonBlockProps) {
  return <div className={`bg-muted/60 animate-pulse ${className}`} style={style} />;
}

export function SkeletonPanel({ rows }: { rows: number }) {
  return (
    <div className="border-border bg-card grid gap-3 rounded-md border p-4">
      {Array.from({ length: rows }, (_, index) => (
        <SkeletonBlock
          key={index}
          className="h-4 rounded"
          style={{ width: `${index === 0 ? 44 : 86 - (index % 3) * 12}%` }}
        />
      ))}
    </div>
  );
}

// ============================================================
// Tree Surface Skeleton — 会话树面板懒加载占位
// ============================================================

import { SkeletonBlock, SkeletonPanel } from '@/components/common/Skeleton';

export function TreeSurfaceSkeleton() {
  return (
    <main className="bg-tree-background text-foreground flex h-screen min-h-0 flex-col overflow-hidden">
      <section className="flex shrink-0 items-center gap-2 px-4 py-2">
        <SkeletonBlock className="h-7 min-w-56 flex-1 rounded-full" />
        <SkeletonBlock className="h-7 w-36 rounded-full" />
        <SkeletonBlock className="size-7 rounded-full" />
      </section>

      <section className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(280px,360px)] gap-3 p-3">
        <div className="border-border bg-card grid content-start gap-2 rounded-md border p-3 shadow-sm">
          {Array.from({ length: 9 }, (_, index) => (
            <SkeletonBlock
              key={index}
              className="h-7 rounded-md"
              style={{ width: `${92 - (index % 4) * 8}%` }}
            />
          ))}
        </div>
        <aside className="border-border bg-card grid content-start gap-3 rounded-md border p-4 shadow-sm">
          <SkeletonBlock className="h-5 w-36" />
          <SkeletonPanel rows={4} />
          <SkeletonBlock className="h-8 w-full rounded-md" />
        </aside>
      </section>
    </main>
  );
}

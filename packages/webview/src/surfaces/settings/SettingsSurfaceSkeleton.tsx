// ============================================================
// Settings Surface Skeleton — 设置面板懒加载占位
// ============================================================

import { SkeletonBlock, SkeletonPanel } from '@/components/common/Skeleton';

export function SettingsSurfaceSkeleton() {
  return (
    <main className="bg-tree-background text-foreground grid h-screen min-h-0 grid-cols-[192px_minmax(0,1fr)] overflow-hidden">
      <aside className="flex h-screen flex-col gap-3 px-3 py-5">
        <SkeletonBlock className="size-8 rounded-full" />
        <SkeletonBlock className="mt-3 h-9 w-full rounded-full" />
        <SkeletonBlock className="h-9 w-full rounded-full" />
        <SkeletonBlock className="h-9 w-full rounded-full" />
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center justify-between px-8 pt-5 pb-3">
          <SkeletonBlock className="h-6 w-28" />
          <div className="flex items-center gap-2">
            <SkeletonBlock className="h-8 w-20 rounded-md" />
            <SkeletonBlock className="h-8 w-20 rounded-md" />
          </div>
        </header>
        <div className="grid gap-4 px-8 py-3">
          <SkeletonPanel rows={4} />
          <SkeletonPanel rows={3} />
        </div>
      </section>
    </main>
  );
}

// ============================================================
// Settings Surface Skeleton — 设置面板懒加载占位
// ============================================================

import { SkeletonBlock, SkeletonPanel } from '@/components/common/Skeleton';

export function SettingsSurfaceSkeleton() {
  return (
    <div className="bg-tree-background text-foreground grid h-screen min-h-0 grid-cols-[192px_minmax(0,1fr)] overflow-hidden">
      <aside className="bg-tree-background flex h-screen min-w-0 flex-col overflow-hidden px-2 py-5">
        <SkeletonBlock className="ml-1 size-8 rounded-full" />
        <nav className="mt-5 grid gap-1" aria-label="设置分类加载中">
          <SkeletonBlock className="h-9 w-full rounded-full" />
          <SkeletonBlock className="h-9 w-full rounded-full" />
          <SkeletonBlock className="h-9 w-full rounded-full" />
          <SkeletonBlock className="h-9 w-full rounded-full" />
        </nav>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 px-8 pt-5 pb-3 max-[720px]:px-5">
          <SkeletonBlock className="h-6 w-28" />
          <div className="flex items-center gap-2">
            <SkeletonBlock className="h-8 w-20 rounded-md" />
            <SkeletonBlock className="h-8 w-20 rounded-md" />
          </div>
        </header>
        <div className="mx-auto box-border grid w-full max-w-6xl min-w-0 gap-5 overflow-x-hidden px-8 py-5 pr-10 max-[720px]:px-5 max-[720px]:pr-7">
          <SkeletonPanel rows={4} />
          <SkeletonPanel rows={3} />
          <SkeletonPanel rows={3} />
        </div>
      </main>
    </div>
  );
}

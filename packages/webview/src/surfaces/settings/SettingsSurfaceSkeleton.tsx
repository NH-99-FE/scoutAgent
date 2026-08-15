// ============================================================
// Settings Surface Skeleton — 设置面板懒加载占位
// ============================================================

import { SkeletonBlock } from '@/components/common/Skeleton';

const SIDEBAR_LABEL_WIDTHS = ['w-20', 'w-12', 'w-16', 'w-20', 'w-12'] as const;

export function SettingsSurfaceSkeleton() {
  return (
    <div className="bg-tree-background text-foreground grid h-screen min-h-0 grid-cols-[192px_minmax(0,1fr)] overflow-hidden">
      <aside className="bg-tree-background flex h-screen min-w-0 flex-col overflow-hidden px-2 py-5">
        <SkeletonBlock className="ml-1 size-8 rounded-full" />
        <nav className="mt-5 grid gap-1" aria-label="设置分类加载中">
          {SIDEBAR_LABEL_WIDTHS.map((width, index) => (
            <div key={index} className="flex h-9 items-center gap-2 px-3">
              <SkeletonBlock className="size-4 shrink-0 rounded" />
              <SkeletonBlock className={`h-3 rounded ${width}`} />
            </div>
          ))}
        </nav>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 px-8 pt-5 pb-3 max-[720px]:px-5">
          <SkeletonBlock className="h-6 w-20 rounded" />
          <div className="flex items-center gap-2">
            <SkeletonBlock className="h-8 w-[74px] rounded-lg" />
            <SkeletonBlock className="h-8 w-[74px] rounded-lg" />
          </div>
        </header>

        <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-5 overflow-hidden px-8 py-5 max-[720px]:px-5">
          <ProviderTabsSkeleton />
          <ProviderSettingsSkeleton />
          <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
            <ModelListSkeleton />
            <ModelDetailSkeleton />
          </div>
        </div>
      </main>
    </div>
  );
}

function ProviderTabsSkeleton() {
  return (
    <div className="border-border bg-muted/30 flex w-fit gap-1 rounded-lg border p-1">
      <SkeletonBlock className="h-8 w-24 rounded-md" />
      <SkeletonBlock className="h-8 w-24 rounded-md" />
    </div>
  );
}

function ProviderSettingsSkeleton() {
  return (
    <section
      aria-label="Provider 设置加载中"
      className="border-border/70 bg-background/40 rounded-lg border p-4"
    >
      <SkeletonBlock className="h-5 w-28 rounded" />
      <SkeletonBlock className="mt-2 h-3 w-72 max-w-full rounded" />
      <div className="mt-4 grid grid-cols-3 gap-4 max-[980px]:grid-cols-1">
        <FieldSkeleton width="w-14" />
        <FieldSkeleton width="w-16" />
        <FieldSkeleton width="w-10" />
      </div>
    </section>
  );
}

function ModelListSkeleton() {
  return (
    <section
      aria-label="模型列表加载中"
      className="border-border/70 bg-background/40 grid content-start gap-3 rounded-lg border p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <SkeletonBlock className="h-5 w-20 rounded" />
        <SkeletonBlock className="h-8 w-20 rounded-lg" />
      </div>
      {[0, 1, 2].map((index) => (
        <div key={index} className="border-border/60 grid gap-2 rounded-lg border p-3">
          <SkeletonBlock className="h-4 w-2/3 rounded" />
          <SkeletonBlock className="h-3 w-1/2 rounded" />
        </div>
      ))}
    </section>
  );
}

function ModelDetailSkeleton() {
  return (
    <section
      aria-label="模型详情加载中"
      className="border-border/70 bg-background/40 rounded-lg border p-4"
    >
      <SkeletonBlock className="h-5 w-28 rounded" />
      <SkeletonBlock className="mt-2 h-3 w-48 max-w-full rounded" />
      <div className="mt-4 grid grid-cols-2 gap-4 max-[900px]:grid-cols-1">
        <FieldSkeleton width="w-14" />
        <FieldSkeleton width="w-12" />
        <FieldSkeleton width="w-20" />
        <FieldSkeleton width="w-16" />
      </div>
    </section>
  );
}

function FieldSkeleton({ width }: { width: string }) {
  return (
    <div className="grid gap-1.5">
      <SkeletonBlock className={`h-3 rounded ${width}`} />
      <SkeletonBlock className="h-8 w-full rounded-lg" />
    </div>
  );
}

// ============================================================
// Changes Review Surface — 文件路径展示
// ============================================================

export function ReviewPath({ path }: { path: string }) {
  const normalized = String(path ?? '').replace(/\\/g, '/');
  const slashIndex = normalized.lastIndexOf('/');
  if (slashIndex < 0) {
    return (
      <span className="block min-w-0 overflow-hidden text-[13px] font-normal text-ellipsis whitespace-nowrap">
        <span className="text-foreground font-normal">{normalized}</span>
      </span>
    );
  }

  return (
    <span className="block min-w-0 overflow-hidden text-[13px] font-normal text-ellipsis whitespace-nowrap">
      <span className="text-muted-foreground group-hover/file-row:text-foreground/75 group-focus-within/file-row:text-foreground/75 transition-colors">
        {normalized.slice(0, slashIndex + 1)}
      </span>
      <span className="text-foreground font-normal">{normalized.slice(slashIndex + 1)}</span>
    </span>
  );
}

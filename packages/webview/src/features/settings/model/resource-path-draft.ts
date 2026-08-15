// ============================================================
// Resource Path Draft — Skills 路径草稿操作
// ============================================================

export function normalizeResourceEntries(entries: string[]): string[] {
  return entries.map((entry) => entry.trim()).filter(Boolean);
}

export function getEditableResourcePathEntries(entries: string[]): string[] {
  return entries.filter((entry) => !isResourceOverrideEntry(entry));
}

export function appendEditableResourcePathEntry(entries: string[]): string[] {
  const firstOverrideIndex = entries.findIndex(isResourceOverrideEntry);
  if (firstOverrideIndex < 0) return [...entries, ''];
  return [...entries.slice(0, firstOverrideIndex), '', ...entries.slice(firstOverrideIndex)];
}

export function updateEditableResourcePathEntry(
  entries: string[],
  index: number,
  value: string,
): string[] {
  let editableIndex = 0;
  let updated = false;
  const nextEntries = entries.map((entry) => {
    if (isResourceOverrideEntry(entry)) return entry;
    if (editableIndex === index) {
      updated = true;
      editableIndex += 1;
      return value;
    }
    editableIndex += 1;
    return entry;
  });
  return updated ? nextEntries : entries;
}

export function removeEditableResourcePathEntry(entries: string[], index: number): string[] {
  let editableIndex = 0;
  return entries.filter((entry) => {
    if (isResourceOverrideEntry(entry)) return true;
    const shouldRemove = editableIndex === index;
    editableIndex += 1;
    return !shouldRemove;
  });
}

export function mergeLocalResourcePathsWithServerOverrides(
  local: string[],
  server: string[],
): string[] {
  return [
    ...local.filter((entry) => !isResourceOverrideEntry(entry)),
    ...server.filter(isResourceOverrideEntry),
  ];
}

export function isResourceOverrideEntry(entry: string): boolean {
  const trimmed = entry.trim();
  return trimmed.startsWith('!') || trimmed.startsWith('+') || trimmed.startsWith('-');
}

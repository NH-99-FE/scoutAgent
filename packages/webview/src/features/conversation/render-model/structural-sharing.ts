// ============================================================
// Structural Sharing — 展示投影结构共享工具
// ============================================================

export function reuseListByKey<T, Key>({
  canReuse,
  getKey,
  next,
  previous,
}: {
  canReuse: (previous: T, next: T) => boolean;
  getKey: (value: T) => Key;
  next: T[];
  previous: T[];
}): T[] {
  const previousByKey = new Map(previous.map((value) => [getKey(value), value]));
  let reusedAny = false;
  const values = next.map((value) => {
    const key = getKey(value);
    if (!previousByKey.has(key)) return value;
    const previousValue = previousByKey.get(key) as T;
    if (!canReuse(previousValue, value)) return value;
    reusedAny ||= previousValue !== value;
    return previousValue;
  });

  return finalizeSharedList(previous, next, values, reusedAny);
}

export function reuseListByIndex<T>({
  canReuse,
  next,
  previous,
}: {
  canReuse: (previous: T, next: T) => boolean;
  next: T[];
  previous: T[];
}): T[] {
  let reusedAny = false;
  const values = next.map((value, index) => {
    if (index >= previous.length) return value;
    const previousValue = previous[index];
    if (!canReuse(previousValue, value)) return value;
    reusedAny ||= previousValue !== value;
    return previousValue;
  });

  return finalizeSharedList(previous, next, values, reusedAny);
}

export function reuseOptional<T>(
  previous: T | undefined,
  next: T | undefined,
  canReuse: (previous: T, next: T) => boolean,
): T | undefined {
  if (previous === undefined || next === undefined) {
    return previous === next ? previous : next;
  }
  return canReuse(previous, next) ? previous : next;
}

function finalizeSharedList<T>(previous: T[], next: T[], values: T[], reusedAny: boolean): T[] {
  if (!reusedAny) return next;
  return values.length === previous.length &&
    values.every((value, index) => value === previous[index])
    ? previous
    : values;
}

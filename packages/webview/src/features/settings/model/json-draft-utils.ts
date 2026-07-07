// ============================================================
// Settings JSON Draft Utils — 表单 JSON 字段转换
// ============================================================

export type OptionalJsonObjectParseResult = Record<string, unknown> | undefined | string;
export type OptionalStringRecordParseResult = Record<string, string> | undefined | string;

export function stringifyOptionalJsonObject(value: Record<string, unknown> | undefined): string {
  return value && Object.keys(value).length > 0 ? JSON.stringify(value, null, 2) : '';
}

export function parseOptionalJsonObject(
  value: string,
  label: string,
): OptionalJsonObjectParseResult {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    if (!isRecord(parsed)) {
      return `${label} 必须是 JSON object`;
    }
    return parsed;
  } catch (error) {
    return `${label} JSON 无效: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export function parseOptionalStringRecordJson(
  value: string,
  label: string,
): OptionalStringRecordParseResult {
  const parsed = parseOptionalJsonObject(value, label);
  if (typeof parsed === 'string' || parsed === undefined) return parsed;
  if (!Object.values(parsed).every((item) => typeof item === 'string')) {
    return `${label} 的所有值都必须是字符串`;
  }
  return parsed as Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

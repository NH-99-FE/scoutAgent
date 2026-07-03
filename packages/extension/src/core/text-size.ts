// ============================================================
// Text size helpers — 文本大小限制与 UTF-8 字节统计
// 负责：为 review、preview 等核心模块提供中性的文本体积约束。
// ============================================================

// ---------- 常量 ----------

export const MAX_REVIEW_TEXT_BYTES = 1024 * 1024;

// ---------- Helpers ----------

export function getUtf8ByteLength(content: string | null): number {
  return content === null ? 0 : Buffer.byteLength(content, 'utf-8');
}

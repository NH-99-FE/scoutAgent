// ============================================================
// Review text helpers — diff/review 文本归一化工具
// 负责：在 core review 层统一换行语义，避免 host 与 tokenizer 各自处理。
// ============================================================

// ---------- Line endings ----------

export function normalizeReviewLineEndings(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function splitReviewLines(content: string): string[] {
  const normalized = normalizeReviewLineEndings(content);
  const lines = normalized.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

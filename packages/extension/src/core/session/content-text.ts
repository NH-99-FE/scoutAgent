// ============================================================
// Session Content Text — 会话内容文本提取
// 负责：为 fork 草稿、候选摘要等会话语义提供一致的文本抽取规则
// ============================================================

// ---------- 类型 ----------

export interface SessionTextContentPart {
  type: string;
  text?: string;
}

export type SessionTextContent = string | SessionTextContentPart[];

// ---------- 提取 ----------

export function extractSessionTextContent(content: SessionTextContent): string {
  if (typeof content === 'string') return content;
  return content
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('');
}

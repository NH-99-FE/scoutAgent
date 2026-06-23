// ============================================================
// Slash Command Trigger — 输入框 slash token 识别
// ============================================================

export interface SlashCommandTrigger {
  query: string;
  range: {
    start: number;
    end: number;
  };
}

export function getSlashCommandTrigger(
  text: string,
  selectionStart: number | null | undefined,
): SlashCommandTrigger | null {
  if (selectionStart === null || selectionStart === undefined) return null;
  const beforeCursor = text.slice(0, selectionStart);
  const match = beforeCursor.match(/^\s*\/([^\s]*)$/);
  if (!match || match.index === undefined) return null;

  const slashIndex = beforeCursor.indexOf('/', match.index);
  if (slashIndex < 0) return null;

  return {
    query: match[1] ?? '',
    range: {
      start: slashIndex,
      end: selectionStart,
    },
  };
}

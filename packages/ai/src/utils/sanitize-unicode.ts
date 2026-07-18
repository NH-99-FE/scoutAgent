// ============================================================
// Unicode 净化 — 移除无效的代理对字符
// ============================================================

/**
 * 移除字符串中未配对的 Unicode 代理对字符。
 *
 * 未配对的代理对（高位代理 0xD800-0xDBFF 没有匹配的低位代理 0xDC00-0xDFFF，
 * 或反之）会导致许多 API 供应商的 JSON 序列化错误。
 *
 * 有效的 emoji 和其他基本多语言平面之外的字符使用正确配对的
 * 代理对，不会被此函数影响。
 *
 * @param text - 需要净化的文本
 * @returns 移除未配对代理对后的文本
 *
 * @example
 * // 有效的 emoji（正确配对的代理对）会被保留
 * sanitizeSurrogates("Hello 🙈 World") // => "Hello 🙈 World"
 *
 * // 未配对的高位代理会被移除
 * const unpaired = String.fromCharCode(0xD83D); // 没有低位代理的高位代理
 * sanitizeSurrogates(`Text ${unpaired} here`) // => "Text  here"
 */
export function sanitizeSurrogates(text: string): string {
  // 替换未配对的高位代理（0xD800-0xDBFF 后面没有低位代理）
  // 替换未配对的低位代理（0xDC00-0xDFFF 前面没有高位代理）
  return text.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    '',
  );
}

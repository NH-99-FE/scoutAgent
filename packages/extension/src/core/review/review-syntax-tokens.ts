// ============================================================
// Review syntax tokens — 审查 diff 的结构化词法高亮
// 负责：把 lowlight AST 转成 shared 可序列化 token，并叠加词级 diff 标记。
// ============================================================

import { diffWordsWithSpace } from 'diff';
import { common, createLowlight } from 'lowlight';
import type { ScoutChangesReviewToken, ScoutChangesReviewTokenDiff } from '@scout-agent/shared';
import { normalizeReviewLineEndings, splitReviewLines } from './review-text.ts';

// ---------- 常量 ----------

const REVIEW_LOWLIGHT = createLowlight(common);
const INTRALINE_MAX_CHANGE_RATIO = 0.5;

const REVIEW_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  bash: 'bash',
  c: 'c',
  cc: 'cpp',
  cjs: 'javascript',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  cts: 'typescript',
  go: 'go',
  graphql: 'graphql',
  h: 'c',
  hpp: 'cpp',
  htm: 'xml',
  html: 'xml',
  ini: 'ini',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsx: 'javascript',
  kt: 'kotlin',
  less: 'less',
  lua: 'lua',
  mjs: 'javascript',
  mts: 'typescript',
  md: 'markdown',
  markdown: 'markdown',
  php: 'php',
  properties: 'ini',
  py: 'python',
  r: 'r',
  rb: 'ruby',
  rs: 'rust',
  scss: 'scss',
  sh: 'bash',
  sql: 'sql',
  svg: 'xml',
  swift: 'swift',
  toml: 'ini',
  ts: 'typescript',
  tsx: 'typescript',
  vue: 'xml',
  wasm: 'wasm',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash',
};

// ---------- 类型 ----------

export type ReviewTokenRange = readonly [number, number];

export interface ReviewTokenizableRow {
  type: 'context' | 'added' | 'removed' | 'fold';
  text?: string;
  tokens?: ScoutChangesReviewToken[];
  hiddenRows?: ReviewTokenizableRow[];
}

interface ReviewHastRoot {
  children?: ReviewHastNode[];
}

interface ReviewHastText {
  type: 'text';
  value: string;
}

interface ReviewHastElement {
  type: 'element';
  properties?: {
    className?: unknown;
  };
  children?: ReviewHastNode[];
}

type ReviewHastNode = ReviewHastText | ReviewHastElement | { type: string };

// ---------- Tokenize ----------

export function createReviewLineTokens(
  content: string,
  filePath?: string,
): ScoutChangesReviewToken[][] {
  const plainLines = splitReviewTokenLines(content);
  const language = filePath ? detectReviewLanguage(filePath) : undefined;
  if (!language) return plainLines.map(createPlainLineTokens);

  try {
    const tree = REVIEW_LOWLIGHT.highlight(language, content);
    return normalizeLineTokens(flattenReviewSyntaxTree(tree), plainLines);
  } catch {
    return plainLines.map(createPlainLineTokens);
  }
}

export function createReviewIntralineRanges(
  oldLine: string,
  newLine: string,
): { added: ReviewTokenRange[]; removed: ReviewTokenRange[] } {
  const added: ReviewTokenRange[] = [];
  const removed: ReviewTokenRange[] = [];
  let oldOffset = 0;
  let newOffset = 0;
  let changed = 0;

  for (const part of diffWordsWithSpace(oldLine, newLine)) {
    const length = part.value.length;
    if (part.added) {
      added.push([newOffset, newOffset + length]);
      newOffset += length;
      changed += length;
      continue;
    }
    if (part.removed) {
      removed.push([oldOffset, oldOffset + length]);
      oldOffset += length;
      changed += length;
      continue;
    }
    oldOffset += length;
    newOffset += length;
  }

  const total = oldLine.length + newLine.length;
  if (total > 0 && changed / total > INTRALINE_MAX_CHANGE_RATIO) {
    return { added: [], removed: [] };
  }
  return { added, removed };
}

export function applyReviewTokenDiff(
  tokens: readonly ScoutChangesReviewToken[] | undefined,
  ranges: readonly ReviewTokenRange[],
  diff: ScoutChangesReviewTokenDiff,
): ScoutChangesReviewToken[] | undefined {
  if (!tokens || tokens.length === 0) return tokens ? [] : undefined;
  if (ranges.length === 0) return [...tokens];

  const next: ScoutChangesReviewToken[] = [];
  let offset = 0;
  for (const token of tokens) {
    let tokenOffset = 0;
    while (tokenOffset < token.text.length) {
      const absoluteOffset = offset + tokenOffset;
      const inRange = isOffsetInRanges(absoluteOffset, ranges);
      const end = findNextRangeBoundary(absoluteOffset, offset + token.text.length, ranges);
      appendReviewToken(next, {
        ...token,
        text: token.text.slice(tokenOffset, end - offset),
        diff: inRange ? diff : token.diff,
      });
      tokenOffset = end - offset;
    }
    offset += token.text.length;
  }
  return next;
}

export function addReviewRowTokens<T extends ReviewTokenizableRow>(
  rows: readonly T[],
  filePath: string,
): T[] {
  const next = rows.map((row) => addReviewSyntaxTokens(row, filePath));

  for (let index = 0; index < next.length; index += 1) {
    const row = next[index];
    if (!isReviewChangedRow(row)) continue;

    const removedRows: T[] = [];
    const addedRows: T[] = [];
    while (index < next.length && isReviewChangedRow(next[index])) {
      const changedRow = next[index];
      if (changedRow.type === 'removed') removedRows.push(changedRow);
      else addedRows.push(changedRow);
      index += 1;
    }
    applyReviewChangedRunDiff(removedRows, addedRows);
    index -= 1;
  }

  return next;
}

export function detectReviewLanguage(filePath: string): string | undefined {
  const fileName = filePath.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  if (fileName === 'dockerfile') {
    return REVIEW_LOWLIGHT.registered('dockerfile') ? 'dockerfile' : undefined;
  }
  if (fileName === 'makefile') return 'makefile';
  const extension = fileName.split('.').pop() ?? '';
  const language = REVIEW_LANGUAGE_BY_EXTENSION[extension];
  return language && REVIEW_LOWLIGHT.registered(language) ? language : undefined;
}

// ---------- AST flatten ----------

function addReviewSyntaxTokens<T extends ReviewTokenizableRow>(row: T, filePath: string): T {
  const hiddenRows = row.hiddenRows ? addReviewRowTokens(row.hiddenRows, filePath) : undefined;
  if (row.type === 'fold' || typeof row.text !== 'string') {
    return hiddenRows ? ({ ...row, hiddenRows } as T) : row;
  }
  const tokens = row.tokens?.length
    ? row.tokens
    : (createReviewLineTokens(row.text, filePath)[0] ?? []);
  return { ...row, hiddenRows, tokens } as T;
}

function applyReviewChangedRunDiff<T extends ReviewTokenizableRow>(
  removedRows: readonly T[],
  addedRows: readonly T[],
): void {
  const pairCount = Math.min(removedRows.length, addedRows.length);
  for (let index = 0; index < pairCount; index += 1) {
    const removedRow = removedRows[index];
    const addedRow = addedRows[index];
    const ranges = createReviewIntralineRanges(removedRow.text ?? '', addedRow.text ?? '');
    removedRow.tokens = applyReviewTokenDiff(removedRow.tokens, ranges.removed, 'removed');
    addedRow.tokens = applyReviewTokenDiff(addedRow.tokens, ranges.added, 'added');
  }
}

function isReviewChangedRow<T extends ReviewTokenizableRow>(
  row: T,
): row is T & { type: 'added' | 'removed' } {
  return row.type === 'added' || row.type === 'removed';
}

function flattenReviewSyntaxTree(tree: ReviewHastRoot): ScoutChangesReviewToken[][] {
  const lines: ScoutChangesReviewToken[][] = [[]];
  appendReviewSyntaxNodes(lines, tree.children ?? [], []);
  return lines;
}

function appendReviewSyntaxNodes(
  lines: ScoutChangesReviewToken[][],
  nodes: readonly ReviewHastNode[],
  syntaxScopes: readonly string[],
): void {
  for (const node of nodes) {
    if (isReviewTextNode(node)) {
      appendReviewSyntaxText(lines, node.value, syntaxScopes);
      continue;
    }
    if (isReviewElementNode(node)) {
      appendReviewSyntaxNodes(lines, node.children ?? [], [
        ...syntaxScopes,
        ...getReviewSyntaxScopes(node),
      ]);
    }
  }
}

function appendReviewSyntaxText(
  lines: ScoutChangesReviewToken[][],
  text: string,
  syntaxScopes: readonly string[],
): void {
  const parts = normalizeReviewLineEndings(text).split('\n');
  parts.forEach((part, index) => {
    if (index > 0) lines.push([]);
    appendReviewToken(lines[lines.length - 1], {
      text: part,
      syntaxScopes: syntaxScopes.length ? [...new Set(syntaxScopes)] : undefined,
    });
  });
}

function getReviewSyntaxScopes(node: ReviewHastElement): string[] {
  const className = node.properties?.className;
  if (!Array.isArray(className)) return [];
  return className
    .filter((value): value is string => typeof value === 'string')
    .filter((value) => /^[A-Za-z0-9_-]+$/.test(value));
}

function normalizeLineTokens(
  tokenLines: ScoutChangesReviewToken[][],
  plainLines: readonly string[],
): ScoutChangesReviewToken[][] {
  const normalized = tokenLines.slice(0, plainLines.length);
  while (normalized.length < plainLines.length) normalized.push([]);
  return normalized.map((tokens, index) =>
    tokens.length ? tokens : createPlainLineTokens(plainLines[index] ?? ''),
  );
}

function createPlainLineTokens(text: string): ScoutChangesReviewToken[] {
  return text ? [{ text }] : [];
}

function appendReviewToken(
  tokens: ScoutChangesReviewToken[],
  token: ScoutChangesReviewToken,
): void {
  if (!token.text) return;
  const previous = tokens[tokens.length - 1];
  if (
    previous &&
    previous.diff === token.diff &&
    areSameSyntaxScopes(previous.syntaxScopes, token.syntaxScopes)
  ) {
    previous.text += token.text;
    return;
  }
  tokens.push(token.syntaxScopes?.length ? token : { text: token.text, diff: token.diff });
}

function splitReviewTokenLines(content: string): string[] {
  return splitReviewLines(content);
}

function isOffsetInRanges(offset: number, ranges: readonly ReviewTokenRange[]): boolean {
  return ranges.some(([start, end]) => offset >= start && offset < end);
}

function findNextRangeBoundary(
  offset: number,
  fallbackEnd: number,
  ranges: readonly ReviewTokenRange[],
): number {
  let end = fallbackEnd;
  for (const [start, rangeEnd] of ranges) {
    if (start > offset && start < end) end = start;
    if (rangeEnd > offset && rangeEnd < end) end = rangeEnd;
  }
  return end;
}

function areSameSyntaxScopes(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (!left?.length && !right?.length) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function isReviewTextNode(node: ReviewHastNode): node is ReviewHastText {
  return node.type === 'text' && typeof (node as ReviewHastText).value === 'string';
}

function isReviewElementNode(node: ReviewHastNode): node is ReviewHastElement {
  return node.type === 'element';
}

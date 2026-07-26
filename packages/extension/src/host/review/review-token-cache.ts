// ============================================================
// Review token cache — lazy syntax tokenization bounded LRU
// ============================================================

import { createHash } from 'node:crypto';
import type { ScoutChangesReviewRow } from '@scout-agent/shared';
import { addReviewRowTokens } from '../../core/review/index.ts';

// ---------- 类型 ----------

export interface ReviewTokenCacheOptions {
  maxEntries?: number;
}

// ---------- Cache ----------

export class ReviewTokenCache {
  private readonly maxEntries: number;
  private readonly entries = new Map<string, ScoutChangesReviewRow[]>();

  constructor(options: ReviewTokenCacheOptions = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? 64);
  }

  tokenize(rows: readonly ScoutChangesReviewRow[], filePath: string): ScoutChangesReviewRow[] {
    const key = createTokenCacheKey(rows, filePath);
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cloneRows(cached);
    }

    const tokenized = addReviewRowTokens(rows, filePath);
    this.entries.set(key, cloneRows(tokenized));
    this.trim();
    return tokenized;
  }

  clear(): void {
    this.entries.clear();
  }

  private trim(): void {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) return;
      this.entries.delete(oldestKey);
    }
  }
}

function createTokenCacheKey(rows: readonly ScoutChangesReviewRow[], filePath: string): string {
  const hash = createHash('sha256');
  hash.update(filePath.toLocaleLowerCase('en-US'));
  for (const row of rows) {
    hash.update('\u0000');
    hash.update(row.type);
    hash.update('\u0000');
    hash.update(String(row.oldLineNumber ?? row.oldStartLine ?? ''));
    hash.update('\u0000');
    hash.update(String(row.newLineNumber ?? row.newStartLine ?? ''));
    hash.update('\u0000');
    hash.update(String(row.count ?? ''));
    hash.update('\u0000');
    hash.update(row.text ?? '');
  }
  return hash.digest('hex');
}

function cloneRows(rows: readonly ScoutChangesReviewRow[]): ScoutChangesReviewRow[] {
  return rows.map((row) => ({
    ...row,
    tokens: row.tokens?.map((token) => ({
      ...token,
      syntaxScopes: token.syntaxScopes && [...token.syntaxScopes],
    })),
  }));
}

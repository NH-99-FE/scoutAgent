// ============================================================
// diagnostics 测试 — AssistantMessage 诊断信息
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  formatThrownValue,
  extractDiagnosticError,
  createAssistantMessageDiagnostic,
  appendAssistantMessageDiagnostic,
} from '../../src/utils/diagnostics';
import type { AssistantMessageDiagnostic } from '../../src/utils/diagnostics';

// ---------- formatThrownValue ----------

describe('formatThrownValue', () => {
  it('formats Error instances using message', () => {
    expect(formatThrownValue(new Error('test error'))).toBe('test error');
  });

  it('formats Error instances with name when message is empty', () => {
    const err = new Error();
    err.name = 'CustomError';
    expect(formatThrownValue(err)).toBe('CustomError');
  });

  it('returns strings as-is', () => {
    expect(formatThrownValue('plain string')).toBe('plain string');
  });

  it('converts other values to string', () => {
    expect(formatThrownValue(42)).toBe('42');
    expect(formatThrownValue(null)).toBe('null');
    expect(formatThrownValue(undefined)).toBe('undefined');
  });
});

// ---------- extractDiagnosticError ----------

describe('extractDiagnosticError', () => {
  it('extracts info from Error instances', () => {
    const err = new Error('something went wrong');
    const info = extractDiagnosticError(err);
    expect(info.message).toBe('something went wrong');
    expect(info.stack).toBeDefined();
  });

  it('extracts code from error when available', () => {
    const err = Object.assign(new Error('network error'), { code: 'ECONNREFUSED' });
    const info = extractDiagnosticError(err);
    expect(info.code).toBe('ECONNREFUSED');
  });

  it('ignores non-string/number codes', () => {
    const err = Object.assign(new Error('bad code'), { code: { custom: true } });
    const info = extractDiagnosticError(err);
    expect(info.code).toBeUndefined();
  });

  it('handles non-Error thrown values', () => {
    const info = extractDiagnosticError('string error');
    expect(info.name).toBe('ThrownValue');
    expect(info.message).toBe('string error');
  });

  it('extracts name from Error', () => {
    const err = new TypeError('type mismatch');
    const info = extractDiagnosticError(err);
    expect(info.name).toBe('TypeError');
    expect(info.message).toBe('type mismatch');
  });
});

// ---------- createAssistantMessageDiagnostic ----------

describe('createAssistantMessageDiagnostic', () => {
  it('creates a diagnostic with error info', () => {
    const diag = createAssistantMessageDiagnostic('retry', new Error('timeout'));
    expect(diag.type).toBe('retry');
    expect(diag.timestamp).toBeGreaterThan(0);
    expect(diag.error).toBeDefined();
    expect(diag.error!.message).toBe('timeout');
  });

  it('creates a diagnostic with details', () => {
    const diag = createAssistantMessageDiagnostic('rate_limit', new Error('429'), {
      retryAfter: 30,
      provider: 'anthropic',
    });
    expect(diag.details).toEqual({ retryAfter: 30, provider: 'anthropic' });
  });

  it('creates a diagnostic without details', () => {
    const diag = createAssistantMessageDiagnostic('timeout', new Error('timed out'));
    expect(diag.details).toBeUndefined();
  });
});

// ---------- appendAssistantMessageDiagnostic ----------

describe('appendAssistantMessageDiagnostic', () => {
  it('appends diagnostic to message with existing diagnostics', () => {
    const existing: AssistantMessageDiagnostic = {
      type: 'retry',
      timestamp: 1000,
      error: { message: 'first error' },
    };
    const message = { diagnostics: [existing] };
    const newDiag: AssistantMessageDiagnostic = {
      type: 'retry',
      timestamp: 2000,
      error: { message: 'second error' },
    };

    appendAssistantMessageDiagnostic(message, newDiag);

    expect(message.diagnostics).toHaveLength(2);
    expect(message.diagnostics![1]).toBe(newDiag);
  });

  it('creates diagnostics array when undefined', () => {
    const message = { diagnostics: undefined as AssistantMessageDiagnostic[] | undefined };
    const diag: AssistantMessageDiagnostic = {
      type: 'error',
      timestamp: 3000,
      error: { message: 'new error' },
    };

    appendAssistantMessageDiagnostic(message, diag);

    expect(message.diagnostics).toHaveLength(1);
    expect(message.diagnostics![0]).toBe(diag);
  });

  it('does not mutate the original diagnostics array', () => {
    const original: AssistantMessageDiagnostic = {
      type: 'first',
      timestamp: 1000,
      error: { message: 'first' },
    };
    const originalArray = [original];
    const message = { diagnostics: originalArray };

    appendAssistantMessageDiagnostic(message, {
      type: 'second',
      timestamp: 2000,
      error: { message: 'second' },
    });

    // Original array should not be mutated (spread creates new array)
    expect(originalArray).toHaveLength(1);
    expect(message.diagnostics).toHaveLength(2);
  });
});

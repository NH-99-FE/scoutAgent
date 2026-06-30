import { describe, expect, it } from 'vitest';
import { createDefaultSessionExportFileName } from '../../src/core/session-file.ts';

describe('createDefaultSessionExportFileName', () => {
  it('includes a safe session id in the default export file name', () => {
    const fileName = createDefaultSessionExportFileName({
      sessionId: 'session-1',
      now: new Date('2026-01-02T03:04:05.006Z'),
    });

    expect(fileName).toBe('session-session-1-2026-01-02T03-04-05-006Z.jsonl');
  });

  it('sanitizes imported session ids before using them in a file name', () => {
    const fileName = createDefaultSessionExportFileName({
      sessionId: '../bad/session id',
      now: new Date('2026-01-02T03:04:05.006Z'),
    });

    expect(fileName).toBe('session-bad-session-id-2026-01-02T03-04-05-006Z.jsonl');
  });

  it('falls back to a timestamp-only file name when the session id has no safe characters', () => {
    const fileName = createDefaultSessionExportFileName({
      sessionId: '../',
      now: new Date('2026-01-02T03:04:05.006Z'),
    });

    expect(fileName).toBe('session-2026-01-02T03-04-05-006Z.jsonl');
  });

  it('limits long imported session ids in the default export file name', () => {
    const fileName = createDefaultSessionExportFileName({
      sessionId: 'a'.repeat(140),
      now: new Date('2026-01-02T03:04:05.006Z'),
    });
    const suffix = '-2026-01-02T03-04-05-006Z.jsonl';
    const sessionIdPart = fileName.slice('session-'.length, -suffix.length);

    expect(sessionIdPart).toHaveLength(80);
    expect(fileName).toBe(`session-${'a'.repeat(80)}${suffix}`);
  });
});

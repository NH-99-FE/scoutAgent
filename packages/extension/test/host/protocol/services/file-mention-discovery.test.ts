import { describe, expect, it, vi } from 'vitest';
import {
  buildFileMentionFdArgs,
  projectFileMentionCandidates,
} from '../../../../src/host/protocol/services/file-mention-discovery.ts';

describe('file mention discovery', () => {
  it('uses fd ignore semantics with stable high-cost excludes and no symlink following', () => {
    const args = buildFileMentionFdArgs('packages/agent', 200);

    expect(args).toEqual(
      expect.arrayContaining([
        '--hidden',
        '--no-require-git',
        '--full-path',
        '--max-results',
        '200',
      ]),
    );
    for (const excluded of ['.git', '.scout', 'node_modules', 'dist', 'out']) {
      const excludeIndex = args.findIndex(
        (argument, index) => argument === '--exclude' && args[index + 1] === excluded,
      );
      expect(excludeIndex).toBeGreaterThanOrEqual(0);
    }
    expect(args).not.toContain('--follow');
    expect(args.at(-2)).toBe('packages[\\\\/]agent');
    expect(args.at(-1)).toBe('.');
  });

  it('projects bounded cwd-relative candidates with directories first', async () => {
    const statPath = vi.fn(async (filePath: string) => ({
      isDirectory: () => filePath.replace(/\\/g, '/').endsWith('/packages/agent'),
    })) as never;

    const items = await projectFileMentionCandidates(
      ['src/agent.ts', 'packages/agent/', '../outside.txt'],
      '/workspace',
      10,
      statPath,
    );

    expect(items).toEqual([
      {
        id: 'packages/agent',
        kind: 'directory',
        path: 'packages/agent',
        label: 'agent',
        description: 'packages',
      },
      {
        id: 'src/agent.ts',
        kind: 'file',
        path: 'src/agent.ts',
        label: 'agent.ts',
        description: 'src',
      },
    ]);
  });
});

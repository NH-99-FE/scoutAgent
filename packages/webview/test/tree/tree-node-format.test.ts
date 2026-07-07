import { describe, expect, it } from 'vitest';
import type { ScoutSessionTreeNode, ScoutSessionTreeToolCall } from '@scout-agent/shared';
import { formatNodeKind, formatNodeLine } from '@/features/tree/model/tree-node-format';

function makeToolNode(toolCall: ScoutSessionTreeToolCall): ScoutSessionTreeNode {
  return {
    id: `result-${toolCall.id}`,
    parentId: 'assistant',
    timestamp: '2026-06-26T10:20:30.000Z',
    type: 'message',
    kind: 'toolResult',
    role: 'toolResult',
    toolCall,
    children: [],
  };
}

function makeBashNode(preview: string | undefined): ScoutSessionTreeNode {
  return {
    id: 'bash-execution',
    parentId: 'user',
    timestamp: '2026-06-26T10:20:30.000Z',
    type: 'message',
    kind: 'bashExecution',
    role: 'bashExecution',
    preview,
    children: [],
  };
}

describe('tree-node-format', () => {
  it('formats bash execution nodes as first-class tree entries', () => {
    const node = makeBashNode('echo ok');

    expect(formatNodeKind(node)).toBe('命令执行');
    expect(formatNodeLine(node)).toBe('[bash] echo ok');
    expect(formatNodeLine(makeBashNode(undefined))).toBe('[bash]');
  });

  it('formats tool result lines from structured tool call metadata', () => {
    const toolCalls: ScoutSessionTreeToolCall[] = [
      {
        id: 'read-1',
        name: 'read',
        arguments: { path: 'src/a.ts', offset: 2, limit: 4 },
        truncated: false,
      },
      { id: 'write-1', name: 'write', arguments: { path: 'src/b.ts' }, truncated: false },
      { id: 'edit-1', name: 'edit', arguments: { path: 'src/c.ts' }, truncated: false },
      {
        id: 'bash-1',
        name: 'bash',
        arguments: {
          command: 'pnpm test -- --runInBand with a very long suffix that is truncated',
        },
        truncated: false,
      },
      {
        id: 'grep-1',
        name: 'grep',
        arguments: { pattern: 'needle', path: 'src' },
        truncated: false,
      },
      {
        id: 'find-1',
        name: 'find',
        arguments: { pattern: '*.ts', path: 'packages' },
        truncated: false,
      },
      { id: 'ls-1', name: 'ls', arguments: { path: 'packages/webview' }, truncated: false },
      {
        id: 'custom-1',
        name: 'custom_tool',
        arguments: { alpha: 'abcdefghijklmnopqrstuvwxyz', beta: 123 },
        truncated: false,
      },
    ];

    expect(toolCalls.map((toolCall) => formatNodeLine(makeToolNode(toolCall)))).toEqual([
      '[read: src/a.ts:2-5]',
      '[write: src/b.ts]',
      '[edit: src/c.ts]',
      '[bash: pnpm test -- --runInBand with a very long suffix t...]',
      '[grep: /needle/ in src]',
      '[find: *.ts in packages]',
      '[ls: packages/webview]',
      '[custom_tool: {"alpha":"abcdefghijklmnopqrstuvwxyz","b...]',
    ]);
  });
});

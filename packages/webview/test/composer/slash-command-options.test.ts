import { describe, expect, it } from 'vitest';
import type { ScoutCommandInfo } from '@scout-agent/shared';
import { buildSlashCommandItems } from '@/features/composer/model/slash-command-options';

const BUILTIN_SOURCE_INFO = {
  path: '<builtin:webview>',
  source: 'builtin',
  scope: 'temporary',
  origin: 'top-level',
} as const;

function builtinCommand(name: string): ScoutCommandInfo {
  return {
    name,
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  };
}

describe('buildSlashCommandItems', () => {
  it('includes session-bound builtins for the current-session composer', () => {
    const items = buildSlashCommandItems({
      allowSessionCommands: true,
      commands: [builtinCommand('tree'), builtinCommand('compact'), builtinCommand('fork')],
      query: '',
    });

    expect(items.map((item) => item.builtinAction)).toEqual(['tree', 'compact', 'fork']);
  });

  it('hides session-bound builtins for the new-session composer', () => {
    const items = buildSlashCommandItems({
      allowSessionCommands: false,
      commands: [builtinCommand('tree'), builtinCommand('compact'), builtinCommand('fork')],
      query: '',
    });

    expect(items).toEqual([]);
  });
});

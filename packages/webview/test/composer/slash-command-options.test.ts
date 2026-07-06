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
  it('includes fork for the current-session composer', () => {
    const items = buildSlashCommandItems({
      allowForkCommand: true,
      commands: [builtinCommand('fork')],
      query: '',
    });

    expect(items.map((item) => item.builtinAction)).toContain('fork');
  });

  it('hides fork for the new-session composer', () => {
    const items = buildSlashCommandItems({
      allowForkCommand: false,
      commands: [builtinCommand('tree'), builtinCommand('fork')],
      query: '',
    });

    expect(items.map((item) => item.builtinAction)).toEqual(['tree']);
  });
});

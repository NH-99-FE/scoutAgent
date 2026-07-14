import { describe, expect, it } from 'vitest';
import type { ScoutToolProfileInfo } from '@scout-agent/shared';
import { resolveNewSessionToolProfileId } from '@/features/composer/model/composer-tool-profile';

const PROFILES: ScoutToolProfileInfo[] = [
  { id: 'develop', name: '开发模式', tools: ['read'], builtin: true },
  { id: 'review', name: '审查模式', tools: ['read'], builtin: true },
];

describe('composer tool profile', () => {
  it('prefers a valid explicit selection over the configured default', () => {
    expect(resolveNewSessionToolProfileId('review', 'develop', PROFILES)).toBe('review');
  });

  it('falls back from stale selections to the default and then the available profile', () => {
    expect(resolveNewSessionToolProfileId('removed', 'develop', PROFILES)).toBe('develop');
    expect(resolveNewSessionToolProfileId(undefined, 'removed', PROFILES)).toBe('develop');
    expect(resolveNewSessionToolProfileId(undefined, 'removed', [])).toBeUndefined();
  });
});

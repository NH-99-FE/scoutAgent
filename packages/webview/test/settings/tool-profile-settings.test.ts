import { describe, expect, it } from 'vitest';
import { reconcileToolProfileSettings } from '@/features/settings/model/tool-profile-settings';

describe('reconcileToolProfileSettings', () => {
  it('updates profiles without touching a default that remains selectable', () => {
    expect(
      reconcileToolProfileSettings({
        scope: 'global',
        settings: { defaultToolProfile: 'develop' },
        inheritedToolProfiles: [],
        profiles: [{ id: 'custom-1', name: '搜索', tools: ['read'] }],
      }),
    ).toEqual({
      patch: { toolProfiles: [{ id: 'custom-1', name: '搜索', tools: ['read'] }] },
      dirtyPaths: ['toolProfiles'],
    });
  });

  it('unsets a removed global custom default', () => {
    expect(
      reconcileToolProfileSettings({
        scope: 'global',
        settings: {
          defaultToolProfile: 'custom-1',
          toolProfiles: [{ id: 'custom-1', name: '搜索', tools: ['read'] }],
        },
        inheritedToolProfiles: [],
        profiles: [],
      }),
    ).toEqual({
      patch: { toolProfiles: undefined, defaultToolProfile: undefined },
      dirtyPaths: ['toolProfiles', 'defaultToolProfile'],
    });
  });

  it('pins a project default when its profile override hides the inherited default', () => {
    expect(
      reconcileToolProfileSettings({
        scope: 'project',
        settings: {},
        inheritedDefaultToolProfile: 'custom-1',
        inheritedToolProfiles: [{ id: 'custom-1', name: '搜索', tools: ['read'] }],
        profiles: [{ id: 'custom-2', name: '编辑', tools: ['edit'] }],
      }),
    ).toEqual({
      patch: {
        toolProfiles: [{ id: 'custom-2', name: '编辑', tools: ['edit'] }],
        defaultToolProfile: 'develop',
      },
      dirtyPaths: ['toolProfiles', 'defaultToolProfile'],
    });
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExtensionsTab } from '@/features/settings/view/ExtensionsTab';
import type { ExtensionSettingsController } from '@/features/settings/hooks/extension-settings-state';

describe('ExtensionsTab', () => {
  it('renders disabled extension resources as disabled list items', () => {
    const openExtensionFile = vi.fn();
    const controller: ExtensionSettingsController = {
      settings: {
        projectDir: '/workspace/.scout/extensions',
        globalDir: '/home/me/.scout/agent/extensions',
        configuredPaths: [],
        templates: [],
        extensions: [
          {
            name: 'disabled-extension',
            path: '/workspace/.scout/extensions/disabled.ts',
            scope: 'project',
            sourceInfo: {
              path: '/workspace/.scout/extensions/disabled.ts',
              source: 'local',
              scope: 'project',
              origin: 'top-level',
              baseDir: '/workspace/.scout/extensions',
            },
            exists: true,
            enabled: false,
          },
        ],
      },
      isLoading: false,
      isSaving: false,
      isDirty: false,
      saved: false,
      error: '',
      load: vi.fn(),
      save: vi.fn(),
      createExtensionFromTemplate: vi.fn(),
      openExtensionFile,
    };

    render(<ExtensionsTab controller={controller} />);

    const row = screen.getByRole('button', { name: /disabled-extension/ });
    expect(row).toBeDisabled();
    expect(screen.getByText('禁用')).toBeInTheDocument();
  });

  it('renders missing configured extension paths as disabled list items', () => {
    const openExtensionFile = vi.fn();
    const controller: ExtensionSettingsController = {
      settings: {
        projectDir: '/workspace/.scout/extensions',
        globalDir: '/home/me/.scout/agent/extensions',
        configuredPaths: ['/workspace/.scout/missing-extension.ts'],
        templates: [],
        extensions: [
          {
            name: 'missing-extension',
            path: '/workspace/.scout/missing-extension.ts',
            scope: 'project',
            sourceInfo: {
              path: '/workspace/.scout/missing-extension.ts',
              source: 'local',
              scope: 'project',
              origin: 'top-level',
              baseDir: '/workspace/.scout',
            },
            exists: false,
            enabled: true,
          },
        ],
      },
      isLoading: false,
      isSaving: false,
      isDirty: false,
      saved: false,
      error: '',
      load: vi.fn(),
      save: vi.fn(),
      createExtensionFromTemplate: vi.fn(),
      openExtensionFile,
    };

    render(<ExtensionsTab controller={controller} />);

    const row = screen.getByRole('button', { name: /missing-extension/ });
    expect(row).toBeDisabled();
    expect(screen.getByText('缺失')).toBeInTheDocument();
  });
});

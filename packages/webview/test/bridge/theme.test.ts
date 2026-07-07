import { afterEach, describe, expect, it } from 'vitest';
import { startWebviewThemeSync } from '@/bridge/theme';

const WEBVIEW_SOURCES = import.meta.glob('../../src/**/*.{css,ts,tsx}', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

describe('startWebviewThemeSync', () => {
  afterEach(() => {
    document.documentElement.className = '';
    document.body.className = '';
    document.documentElement.removeAttribute('style');
    document.body.removeAttribute('style');
    window.history.replaceState(null, '', '/');
  });

  it('preserves VS Code theme variables during production startup', () => {
    document.body.classList.add('vscode-dark');
    document.body.style.setProperty('--vscode-sideBar-background', '#111111');
    document.body.style.setProperty('--vscode-editor-background', '#222222');

    const stop = startWebviewThemeSync();

    expect(document.documentElement).toHaveClass('vscode-dark');
    expect(document.body).toHaveClass('vscode-dark');
    expect(document.body.style.getPropertyValue('--vscode-sideBar-background')).toBe('#111111');
    expect(document.body.style.getPropertyValue('--vscode-editor-background')).toBe('#222222');

    stop();
  });

  it('syncs every VS Code variable referenced outside the theme bridge', () => {
    const referencedVariables = getReferencedVscodeVariables();
    const variables = Object.fromEntries(
      referencedVariables.map((name, index) => [name, `scout-theme-value-${index}`]),
    );

    const stop = startWebviewThemeSync();

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'scout_theme_update',
          theme: 'dark',
          variables,
        },
      }),
    );

    for (const [name, value] of Object.entries(variables)) {
      expect(document.documentElement.style.getPropertyValue(name)).toBe(value);
      expect(document.body.style.getPropertyValue(name)).toBe(value);
    }

    stop();
  });
});

function getReferencedVscodeVariables(): string[] {
  const names = new Set<string>();
  for (const [filePath, source] of Object.entries(WEBVIEW_SOURCES)) {
    if (filePath.endsWith('/bridge/theme.ts')) continue;
    for (const match of source.matchAll(/--vscode-[a-zA-Z0-9-]+/g)) {
      names.add(match[0]);
    }
  }
  return Array.from(names).sort();
}

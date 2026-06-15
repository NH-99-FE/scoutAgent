import { afterEach, describe, expect, it } from 'vitest';
import { startWebviewThemeSync } from '@/bridge/theme';

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
});

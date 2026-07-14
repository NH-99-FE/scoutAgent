import { afterEach, describe, expect, it } from 'vitest';
import THEME_CSS from '../../src/styles/theme.css?raw';
import { expectCssRule, expectNoCssRule, WEBVIEW_CSS, WEBVIEW_CSS_PATHS } from '../webview-css';

describe('webview style smoke', () => {
  afterEach(() => {
    document.documentElement.className = '';
    document.body.className = '';
    document.head.innerHTML = '';
  });

  it('expands every local stylesheet imported by the webview entrypoint', () => {
    expect(WEBVIEW_CSS_PATHS).toEqual([
      '../src/index.css',
      '../src/styles/theme.css',
      '../src/styles/base.css',
      '../src/styles/utilities.css',
      '../src/styles/features/conversation.css',
      '../src/styles/features/changes-review.css',
    ]);
    expect(WEBVIEW_CSS).toContain('.scout-conversation-diff-line-added');
    expect(WEBVIEW_CSS).toContain('.scout-review-empty-split');
  });

  it('applies light, dark, and high-contrast semantic theme overrides', () => {
    installStyle(THEME_CSS);

    document.documentElement.className = 'vscode-light';
    expect(cssVar('--scout-control-hover')).toBe('var(--muted)');
    expect(cssVar('--scout-field-background')).toBe('transparent');
    expect(cssVar('--scout-switch-thumb-checked-background')).toBe('var(--background)');

    document.documentElement.className = 'vscode-dark';
    expect(normalizeCssValue(cssVar('--scout-control-hover'))).toBe(
      'color-mix(insrgb,var(--muted)50%,transparent)',
    );
    expect(normalizeCssValue(cssVar('--scout-field-background'))).toBe(
      'color-mix(insrgb,var(--input)30%,transparent)',
    );
    expect(cssVar('--scout-switch-thumb-checked-background')).toBe('var(--primary-foreground)');

    document.documentElement.className = 'vscode-high-contrast';
    expect(normalizeCssValue(cssVar('--scout-control-selected'))).toBe(
      'color-mix(insrgb,var(--muted)50%,transparent)',
    );
    expect(normalizeCssValue(cssVar('--scout-invalid-ring'))).toBe(
      'color-mix(insrgb,var(--destructive)40%,transparent)',
    );
  });

  it('keeps critical semantic token mappings and feature classes wired', () => {
    expect(THEME_CSS).toContain(
      "@custom-variant focus-visible (&:where([data-scout-tab-focus='true'] *):focus-visible);",
    );
    expectCssRule(':root', [
      '--scout-diff-added: var(--vscode-charts-green, #89d185);',
      '--scout-fallback-link-foreground: #006ab1;',
      '--scout-reference-foreground: var(',
      '--vscode-textLink-foreground,',
      'var(--scout-fallback-link-foreground)',
      '--scout-status-warning: var(--vscode-charts-yellow, #cca700);',
    ]);
    expectCssRule('@theme inline', [
      '--color-control-selected: var(--scout-control-selected);',
      '--color-field-disabled: var(--scout-field-disabled-background);',
      '--color-reference: var(--scout-reference-foreground);',
      '--color-status-warning-muted: var(--scout-status-warning-muted);',
      '--shadow-diff-added: var(--scout-shadow-diff-added);',
    ]);
    expectNoCssRule('*:focus-visible', [
      'outline: 1px solid var(--vscode-focusBorder, var(--border)) !important;',
    ]);
    expectCssRule("[data-scout-tab-focus='true'] *:focus-visible", [
      'outline: 1px solid var(--vscode-focusBorder, var(--border)) !important;',
      'outline-offset: 2px;',
    ]);
    expectCssRule('.scout-conversation-diff-line-added', [
      'color: var(--scout-diff-added);',
      'background-color: color-mix(in srgb, var(--scout-diff-added) 8%, transparent);',
    ]);
    expectCssRule('.scout-review-split-code .scout-review-token-diff-added', [
      'background: var(--scout-review-token-diff-added);',
    ]);
  });
});

function installStyle(css: string): void {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function normalizeCssValue(value: string): string {
  return value.replace(/\s+/g, '');
}

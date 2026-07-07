import { expect } from 'vitest';

const LOCAL_CSS_MODULES = import.meta.glob('../src/**/*.css', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

const ENTRY_CSS_PATH = '../src/index.css';

interface CssExpansionResult {
  css: string;
  paths: string[];
}

const WEBVIEW_CSS_EXPANSION = expandLocalCssImports(ENTRY_CSS_PATH);

export const WEBVIEW_CSS = WEBVIEW_CSS_EXPANSION.css;
export const WEBVIEW_CSS_PATHS = WEBVIEW_CSS_EXPANSION.paths;

export function expectCssRule(selector: string, declarations: string[]): void {
  const matchingRule = findCssRuleBodies(selector).some((body) =>
    declarations.every((declaration) => body.includes(declaration)),
  );
  expect(matchingRule).toBe(true);
}

export function expectNoCssRule(selector: string, declarations: string[]): void {
  const matchingRule = findCssRuleBodies(selector).some((body) =>
    declarations.every((declaration) => body.includes(declaration)),
  );
  expect(matchingRule).toBe(false);
}

export function findCssRuleBodies(selector: string): string[] {
  const bodies: string[] = [];
  let bodyStart = WEBVIEW_CSS.indexOf('{');
  while (bodyStart >= 0) {
    const bodyEnd = WEBVIEW_CSS.indexOf('}', bodyStart);
    if (bodyEnd < 0) break;
    const previousRuleEnd = WEBVIEW_CSS.lastIndexOf('}', bodyStart - 1);
    const selectorText = normalizeSelectorText(WEBVIEW_CSS.slice(previousRuleEnd + 1, bodyStart));
    const selectors = selectorText.split(',').map((candidate) => candidate.trim());
    if (selectors.includes(selector)) {
      bodies.push(WEBVIEW_CSS.slice(bodyStart + 1, bodyEnd));
    }
    bodyStart = WEBVIEW_CSS.indexOf('{', bodyEnd + 1);
  }
  return bodies;
}

function normalizeSelectorText(rawSelectorText: string): string {
  const withoutComments = rawSelectorText.replace(/\/\*[\s\S]*?\*\//g, '');
  return (withoutComments.split(';').at(-1) ?? '').trim();
}

function expandLocalCssImports(entryPath: string): CssExpansionResult {
  const seen = new Set<string>();
  const paths: string[] = [];
  const css = expandCssModule(entryPath, seen, paths);
  return { css, paths };
}

function expandCssModule(modulePath: string, seen: Set<string>, paths: string[]): string {
  if (seen.has(modulePath)) return '';
  seen.add(modulePath);
  paths.push(modulePath);

  const source = LOCAL_CSS_MODULES[modulePath];
  if (source === undefined) {
    throw new Error(`Missing local CSS module for ${modulePath}`);
  }

  let output = '';
  let lastIndex = 0;
  const importPattern = /@import\s+['"]([^'"]+)['"]\s*;/g;
  for (const match of source.matchAll(importPattern)) {
    output += source.slice(lastIndex, match.index);
    const specifier = match[1];
    if (specifier?.startsWith('.')) {
      output += expandCssModule(resolveCssImport(modulePath, specifier), seen, paths);
    } else {
      output += match[0];
    }
    lastIndex = (match.index ?? 0) + match[0].length;
  }
  output += source.slice(lastIndex);
  return output;
}

function resolveCssImport(fromPath: string, specifier: string): string {
  const baseParts = fromPath.split('/').slice(0, -1);
  const parts = [...baseParts, specifier];
  const resolved: string[] = [];
  for (const part of parts.join('/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      resolved.pop();
      continue;
    }
    resolved.push(part);
  }
  const path = resolved.join('/');
  const modulePath = path.startsWith('../') ? path : `../${path}`;
  return modulePath.endsWith('.css') ? modulePath : `${modulePath}.css`;
}

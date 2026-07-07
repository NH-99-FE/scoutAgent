import { describe, expect, it } from 'vitest';

const SOURCE_MODULES = import.meta.glob('../../src/**/*.{ts,tsx}', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

const STYLE_MODULES = import.meta.glob('../../src/**/*.css', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

const ALL_SOURCE_MODULES = import.meta.glob('../../src/**/*.{css,ts,tsx}', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

const RAW_COLOR_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  {
    label: 'Tailwind palette color class',
    pattern:
      /\b(?:dark:)?(?:(?:hover|focus|focus-visible|focus-within|disabled|placeholder|file|aria-[^:]+|data-[^:]+|group-hover\/[^:]+|group-focus-within\/[^:]+):)*(?:bg|text|border|ring|fill|stroke|decoration)-(?:red|yellow|green|emerald|blue|sky|cyan|purple|violet|pink|rose|orange|amber|lime|teal|indigo|slate|gray|zinc|neutral|stone|black|white)(?:-|\/|$)/,
  },
  {
    label: 'theme-specific dark state color override',
    pattern:
      /\bdark:(?:hover:|focus-within:|data-[^:]+:|disabled:|aria-[^:]+:)?(?:bg|text|border|ring)-/,
  },
  {
    label: 'raw CSS color literal',
    pattern: /#[0-9a-fA-F]{3,8}\b|\brgba?\(/,
  },
  {
    label: 'raw chart or feature CSS variable utility',
    pattern: /\b(?:bg|text|border|ring|fill|stroke)-\[var\(--(?:chart|changes-review)-/,
  },
  {
    label: 'ad-hoc foreground alpha background',
    pattern: /\bbg-foreground\/\[/,
  },
  {
    label: 'raw Scout CSS variable in TypeScript view code',
    pattern: /\bvar\(--scout-/,
  },
];

const CSS_COLOR_LITERAL_PATTERN = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/;
const CSS_COLOR_LITERAL_ALLOWLIST: Array<{ file: RegExp; line: RegExp }> = [
  {
    file: /\/src\/styles\/theme\.css$/,
    line: /--scout-(?:shadow|fallback)-/,
  },
  {
    file: /\/src\/styles\/theme\.css$/,
    line: /--scout-(?:diff-added|diff-removed|status-warning|action-background|action-foreground):\s*var\(/,
  },
  {
    file: /\/src\/styles\/theme\.css$/,
    line: /--scout-overlay-background:/,
  },
  {
    file: /\/src\/styles\/features\/changes-review\.css$/,
    line: /--scout-review-token-/,
  },
];

const FEATURE_PRIVATE_TOKEN_SCOPES: Array<{ prefix: string; allowedFile: RegExp }> = [
  {
    prefix: '--scout-review-',
    allowedFile: /\/src\/(?:styles\/features\/changes-review\.css|surfaces\/changes-review\/)/,
  },
  {
    prefix: '--changes-review-',
    allowedFile: /\/src\/(?:styles\/features\/changes-review\.css|surfaces\/changes-review\/)/,
  },
  {
    prefix: '--scout-running-text-',
    allowedFile: /\/src\/styles\/features\/conversation\.css$/,
  },
];

describe('webview CSS token governance', () => {
  it('keeps raw color decisions out of TypeScript view code', () => {
    const violations = Object.entries(SOURCE_MODULES).flatMap(([filePath, source]) =>
      findRawColorViolations(filePath, source),
    );

    expect(violations).toEqual([]);
  });

  it('keeps raw CSS color literals confined to token source files', () => {
    const violations = Object.entries(STYLE_MODULES).flatMap(([filePath, source]) =>
      findRawCssColorLiteralViolations(filePath, source),
    );

    expect(violations).toEqual([]);
  });

  it('keeps feature-private CSS variables inside their owning feature', () => {
    const violations = Object.entries(ALL_SOURCE_MODULES).flatMap(([filePath, source]) =>
      findFeaturePrivateTokenViolations(filePath, source),
    );

    expect(violations).toEqual([]);
  });
});

function findRawColorViolations(filePath: string, source: string): string[] {
  return source
    .split('\n')
    .flatMap((line, index) =>
      RAW_COLOR_PATTERNS.filter(({ pattern }) => pattern.test(line)).map(
        ({ label }) => `${filePath}:${index + 1} ${label}: ${line.trim()}`,
      ),
    );
}

function findRawCssColorLiteralViolations(filePath: string, source: string): string[] {
  const normalizedFilePath = normalizeFilePath(filePath);
  return source.split('\n').flatMap((line, index) => {
    if (!CSS_COLOR_LITERAL_PATTERN.test(line)) return [];
    if (isAllowedCssColorLiteral(normalizedFilePath, line)) return [];
    return [`${filePath}:${index + 1} raw CSS color literal: ${line.trim()}`];
  });
}

function isAllowedCssColorLiteral(filePath: string, line: string): boolean {
  return CSS_COLOR_LITERAL_ALLOWLIST.some(
    ({ file, line: allowedLine }) => file.test(filePath) && allowedLine.test(line),
  );
}

function findFeaturePrivateTokenViolations(filePath: string, source: string): string[] {
  const normalizedFilePath = normalizeFilePath(filePath);
  return source.split('\n').flatMap((line, index) =>
    FEATURE_PRIVATE_TOKEN_SCOPES.filter(({ prefix, allowedFile }) => {
      if (!line.includes(prefix)) return false;
      return !allowedFile.test(normalizedFilePath);
    }).map(
      ({ prefix }) =>
        `${filePath}:${index + 1} leaked feature-private token ${prefix}: ${line.trim()}`,
    ),
  );
}

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\.\/\.\./, '');
}

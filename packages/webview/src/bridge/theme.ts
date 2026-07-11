// ============================================================
// Webview Theme — VS Code 主题 class 同步
// ============================================================

type ScoutThemeKind = 'light' | 'dark' | 'high-contrast';

const THEME_CLASSES = ['vscode-light', 'vscode-dark', 'vscode-high-contrast'] as const;
const THEME_VARIABLES = [
  '--vscode-font-family',
  '--vscode-editor-font-family',
  '--vscode-editor-font-size',
  '--vscode-tab-activeBackground',
  '--vscode-sideBar-background',
  '--vscode-editor-background',
  '--vscode-foreground',
  '--vscode-editorWidget-background',
  '--vscode-editorWidget-foreground',
  '--vscode-menu-background',
  '--vscode-menu-foreground',
  '--vscode-dropdown-background',
  '--vscode-dropdown-foreground',
  '--vscode-toolbar-hoverBackground',
  '--vscode-list-hoverBackground',
  '--vscode-descriptionForeground',
  '--vscode-contrastBorder',
  '--vscode-widget-border',
  '--vscode-panel-border',
  '--vscode-input-border',
  '--vscode-input-placeholderForeground',
  '--vscode-focusBorder',
  '--vscode-textLink-foreground',
  '--vscode-errorForeground',
  '--vscode-charts-green',
  '--vscode-charts-yellow',
  '--vscode-charts-red',
] as const;

interface ScoutThemeUpdateMessage {
  type: 'scout_theme_update';
  theme: ScoutThemeKind;
  variables?: Record<string, string>;
}

export function startWebviewThemeSync(): () => void {
  applyInitialTheme();

  const handler = (event: MessageEvent<unknown>) => {
    if (!isScoutThemeUpdateMessage(event.data)) return;
    applyTheme(event.data.theme, event.data.variables);
  };

  window.addEventListener('message', handler);
  requestThemeVariables();
  return () => window.removeEventListener('message', handler);
}

function requestThemeVariables(): void {
  if (!getThemeFromQuery()) return;
  if (window.parent === window) return;
  window.parent.postMessage({ type: 'scout_theme_ready' }, '*');
}

function applyInitialTheme(): void {
  const queryTheme = getThemeFromQuery();
  if (queryTheme) {
    applyTheme(queryTheme);
    return;
  }

  const classTheme = getThemeFromClasses();
  if (classTheme) applyTheme(classTheme);
}

function applyTheme(theme: ScoutThemeKind, variables?: Record<string, string>): void {
  const themeClass = `vscode-${theme}`;
  for (const element of [document.documentElement, document.body]) {
    element.classList.remove(...THEME_CLASSES);
    element.classList.add(themeClass);
  }
  if (variables) applyThemeVariables(variables);
}

function applyThemeVariables(variables: Record<string, string> | undefined): void {
  for (const name of THEME_VARIABLES) {
    document.documentElement.style.removeProperty(name);
    document.body.style.removeProperty(name);
  }
  if (!variables) return;

  for (const name of THEME_VARIABLES) {
    const value = variables[name];
    if (!value) continue;
    document.documentElement.style.setProperty(name, value);
    document.body.style.setProperty(name, value);
  }
}

function getThemeFromQuery(): ScoutThemeKind | undefined {
  const theme = new URLSearchParams(window.location.search).get('theme');
  return isThemeKind(theme) ? theme : undefined;
}

function getThemeFromClasses(): ScoutThemeKind | undefined {
  const className = [document.documentElement.className, document.body.className].join(' ');
  if (className.includes('vscode-high-contrast')) return 'high-contrast';
  if (className.includes('vscode-dark')) return 'dark';
  if (className.includes('vscode-light')) return 'light';
  return undefined;
}

function isScoutThemeUpdateMessage(value: unknown): value is ScoutThemeUpdateMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<ScoutThemeUpdateMessage>;
  return message.type === 'scout_theme_update' && isThemeKind(message.theme);
}

function isThemeKind(value: unknown): value is ScoutThemeKind {
  return value === 'light' || value === 'dark' || value === 'high-contrast';
}

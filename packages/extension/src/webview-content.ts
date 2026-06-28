// ============================================================
// Webview 内容加载 — 复用 Sidebar / Settings / Tree 的资源装载逻辑
// ============================================================

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  EXTENSION_TO_WEBVIEW_MESSAGE_TYPES,
  WEBVIEW_TO_EXTENSION_MESSAGE_TYPES,
} from '@scout-agent/shared';
import type { ScoutWebviewSurface } from './host/webview-surface.ts';

const DEV_SERVER_URL = 'http://localhost:5173';
const THEME_VARIABLES = [
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
  '--vscode-toolbar-activeBackground',
  '--vscode-list-hoverBackground',
  '--vscode-descriptionForeground',
  '--vscode-contrastBorder',
  '--vscode-widget-border',
  '--vscode-panel-border',
  '--vscode-input-border',
  '--vscode-input-placeholderForeground',
  '--vscode-focusBorder',
  '--vscode-errorForeground',
  '--vscode-charts-blue',
  '--vscode-charts-green',
  '--vscode-charts-yellow',
  '--vscode-charts-orange',
  '--vscode-charts-red',
];
const STARTUP_BACKGROUND =
  'var(--vscode-sideBar-background, var(--vscode-editor-background, #252526))';

const STARTUP_THEME_STYLE = `<style data-scout-startup-theme>
    :root { color: var(--vscode-foreground); background: ${STARTUP_BACKGROUND}; }
    html, body, #root, #scout-webview-frame { background: ${STARTUP_BACKGROUND}; }
  </style>`;

export function configureScoutWebview(extensionUri: vscode.Uri, webview: vscode.Webview): void {
  const localRoot = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
  webview.options = {
    enableScripts: true,
    localResourceRoots: [localRoot],
  };
}

export async function getScoutWebviewHtml(
  extensionUri: vscode.Uri,
  webview: vscode.Webview,
  isDev: boolean,
  surface: ScoutWebviewSurface,
): Promise<string> {
  if (isDev && (await probeDevServer())) {
    return getHmrHtml(surface);
  }
  return getLocalHtml(extensionUri, webview, surface);
}

function probeDevServer(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(DEV_SERVER_URL, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function getHmrHtml(surface: ScoutWebviewSurface): string {
  const url = `${DEV_SERVER_URL}?surface=${encodeURIComponent(surface)}`;
  const devOrigin = new URL(DEV_SERVER_URL).origin;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${devOrigin}; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
  <title>${getSurfaceTitle(surface)}</title>
  ${STARTUP_THEME_STYLE}
  <style>
    body { margin: 0; padding: 0; overflow: hidden; height: 100vh; color: var(--vscode-foreground); }
    iframe { width: 100%; height: 100%; border: none; opacity: 0; background: ${STARTUP_BACKGROUND}; }
    iframe[data-scout-ready="true"] { opacity: 1; }
  </style>
</head>
<body>
  <iframe id="scout-webview-frame"></iframe>
  <script>
    (() => {
      const frame = document.getElementById('scout-webview-frame');
      const vscode = acquireVsCodeApi();
      const devOrigin = ${JSON.stringify(devOrigin)};
      const devUrl = ${JSON.stringify(url)};
      const webviewToExtensionTypes = new Set(${JSON.stringify(WEBVIEW_TO_EXTENSION_MESSAGE_TYPES)});
      const extensionToWebviewTypes = new Set(${JSON.stringify(EXTENSION_TO_WEBVIEW_MESSAGE_TYPES)});
      const getTheme = () => {
        const className = [
          document.documentElement.className,
          document.body.className,
        ].join(' ');
        if (className.includes('vscode-high-contrast')) return 'high-contrast';
        if (className.includes('vscode-dark')) return 'dark';
        return 'light';
      };
      const getThemeVariables = () => {
        const rootStyles = getComputedStyle(document.documentElement);
        const bodyStyles = getComputedStyle(document.body);
        return ${JSON.stringify(THEME_VARIABLES)}.reduce((variables, name) => {
          const value =
            rootStyles.getPropertyValue(name).trim() ||
            bodyStyles.getPropertyValue(name).trim();
          if (value) variables[name] = value;
          return variables;
        }, {});
      };
      const getFrameUrl = () => {
        const nextUrl = new URL(devUrl);
        nextUrl.searchParams.set('theme', getTheme());
        return nextUrl.toString();
      };
      const postTheme = () => {
        frame.contentWindow?.postMessage(
          { type: 'scout_theme_update', theme: getTheme(), variables: getThemeVariables() },
          devOrigin,
        );
      };
      const isMessageObject = (value) =>
        value !== null && typeof value === 'object' && typeof value.type === 'string';
      const isFrameMessage = (event) =>
        event.source === frame.contentWindow && event.origin === devOrigin;
      frame.addEventListener('load', postTheme);
      new MutationObserver(postTheme).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      });
      new MutationObserver(postTheme).observe(document.body, {
        attributes: true,
        attributeFilter: ['class'],
      });
      window.addEventListener('message', (event) => {
        if (!isMessageObject(event.data)) return;
        if (isFrameMessage(event)) {
          if (event.data.type === 'scout_theme_ready') {
            frame.dataset.scoutReady = 'true';
            postTheme();
            return;
          }
          if (webviewToExtensionTypes.has(event.data.type)) {
            vscode.postMessage(event.data);
          }
          return;
        }
        if (extensionToWebviewTypes.has(event.data.type)) {
          frame.contentWindow?.postMessage(event.data, devOrigin);
        }
      });
      frame.src = getFrameUrl();
    })();
  </script>
</body>
</html>`;
}

function getLocalHtml(
  extensionUri: vscode.Uri,
  webview: vscode.Webview,
  surface: ScoutWebviewSurface,
): string {
  const webviewDist = path.join(extensionUri.fsPath, 'dist', 'webview');
  const indexHtmlPath = path.join(webviewDist, 'index.html');

  if (fs.existsSync(indexHtmlPath)) {
    let html = fs.readFileSync(indexHtmlPath, 'utf-8');
    const webviewUri = webview.asWebviewUri(vscode.Uri.file(webviewDist));
    html = html.replace(
      /(src|href)="([^"]*)"/g,
      (_, attr, src) => `${attr}="${webviewUri}/${src}"`,
    );
    return injectSurface(html, surface);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${getSurfaceTitle(surface)}</title>
  <style>
    body { font-family: var(--vscode-font-family); padding: 12px; }
    h2 { color: var(--vscode-foreground); }
    p { color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <h2>${getSurfaceTitle(surface)}</h2>
  <p>Webview not built yet. Run <code>pnpm run build</code> in the webview package first.</p>
</body>
</html>`;
}

function injectSurface(html: string, surface: ScoutWebviewSurface): string {
  const script = `${STARTUP_THEME_STYLE}<script>window.__SCOUT_WEBVIEW_SURFACE__=${JSON.stringify(surface)};</script>`;
  const headOpen = html.match(/<head[^>]*>/i);
  if (headOpen?.index !== undefined) {
    const insertAt = headOpen.index + headOpen[0].length;
    return `${html.slice(0, insertAt)}${script}${html.slice(insertAt)}`;
  }
  if (html.includes('</head>')) {
    return html.replace('</head>', `${script}</head>`);
  }
  return `${script}${html}`;
}

function getSurfaceTitle(surface: ScoutWebviewSurface): string {
  if (surface === 'settings') return 'Scout Settings';
  if (surface === 'tree') return 'Scout Tree';
  return 'Scout Agent';
}

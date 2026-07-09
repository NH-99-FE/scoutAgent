// ============================================================
// Webview 内容加载 — 复用 Sidebar / Settings / Tree 的资源装载逻辑
// ============================================================

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ScoutChangesReviewModel } from '@scout-agent/shared';
import type { ScoutWebviewSurface } from './host/webview-surface.ts';

const DEV_SERVER_URL = 'http://localhost:5173';
const STARTUP_BACKGROUND =
  'var(--vscode-sideBar-background, var(--vscode-editor-background, #252526))';

const STARTUP_THEME_STYLE = `<style data-scout-startup-theme>
    :root { color: var(--vscode-foreground); background: ${STARTUP_BACKGROUND}; }
    html, body, #root { background: ${STARTUP_BACKGROUND}; }
  </style>`;

export interface ScoutWebviewBootstrapData {
  changesReview?: ScoutChangesReviewModel;
}

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
  probeDevServerFn: () => Promise<boolean> = probeDevServer,
  bootstrapData: ScoutWebviewBootstrapData = {},
): Promise<string> {
  if (isDev && (await probeDevServerFn())) {
    return getHmrHtml(surface, bootstrapData);
  }
  return getLocalHtml(extensionUri, webview, surface, bootstrapData);
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

function getHmrHtml(
  surface: ScoutWebviewSurface,
  bootstrapData: ScoutWebviewBootstrapData,
): string {
  const devOrigin = new URL(DEV_SERVER_URL).origin;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${devOrigin} data: blob:; font-src ${devOrigin} data:; style-src ${devOrigin} 'unsafe-inline'; script-src ${devOrigin} 'unsafe-inline'; connect-src ${devOrigin} ws://localhost:5173;">
  <title>${getSurfaceTitle(surface)}</title>
  ${STARTUP_THEME_STYLE}
  <style>
    body { margin: 0; padding: 0; overflow: hidden; height: 100vh; color: var(--vscode-foreground); }
  </style>
  ${renderBootstrapScript(surface, bootstrapData)}
  <script type="module">
    import RefreshRuntime from '${devOrigin}/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
  </script>
  <script type="module" src="${devOrigin}/@vite/client"></script>
  <script type="module" src="${devOrigin}/src/main.tsx"></script>
</head>
<body>
  <div id="root"></div>
</body>
</html>`;
}

function getLocalHtml(
  extensionUri: vscode.Uri,
  webview: vscode.Webview,
  surface: ScoutWebviewSurface,
  bootstrapData: ScoutWebviewBootstrapData,
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
    return injectSurface(html, surface, bootstrapData);
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

function injectSurface(
  html: string,
  surface: ScoutWebviewSurface,
  bootstrapData: ScoutWebviewBootstrapData,
): string {
  const script = `${STARTUP_THEME_STYLE}${renderBootstrapScript(surface, bootstrapData)}`;
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

function renderBootstrapScript(
  surface: ScoutWebviewSurface,
  bootstrapData: ScoutWebviewBootstrapData,
): string {
  const assignments = [`window.__SCOUT_WEBVIEW_SURFACE__=${JSON.stringify(surface)};`];
  if (bootstrapData.changesReview) {
    assignments.push(
      `window.__SCOUT_CHANGES_REVIEW__=${JSON.stringify(bootstrapData.changesReview).replace(/</g, '\\u003c')};`,
    );
  }
  return `<script>${assignments.join('')}</script>`;
}

function getSurfaceTitle(surface: ScoutWebviewSurface): string {
  if (surface === 'settings') return 'Scout Settings';
  if (surface === 'tree') return 'Scout Tree';
  if (surface === 'changes-review') return 'Scout Diff';
  return 'Scout Agent';
}

// ============================================================
// Webview 内容加载 — 复用 Sidebar / Settings / Tree 的资源装载逻辑
// ============================================================

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ScoutWebviewSurface } from './host/webview-surface.ts';

const DEV_SERVER_URL = 'http://localhost:5173';

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
  <style>
    body { margin: 0; padding: 0; overflow: hidden; height: 100vh; }
    iframe { width: 100%; height: 100%; border: none; }
  </style>
</head>
<body>
  <iframe id="scout-webview-frame" src="${url}"></iframe>
  <script>
    (() => {
      const frame = document.getElementById('scout-webview-frame');
      const vscode = acquireVsCodeApi();
      const devOrigin = ${JSON.stringify(devOrigin)};
      window.addEventListener('message', (event) => {
        if (event.source === frame.contentWindow) {
          if (event.origin !== devOrigin) return;
          vscode.postMessage(event.data);
          return;
        }
        frame.contentWindow?.postMessage(event.data, devOrigin);
      });
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
  const script = `<script>window.__SCOUT_WEBVIEW_SURFACE__=${JSON.stringify(surface)};</script>`;
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

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  EXTENSION_TO_WEBVIEW_MESSAGE_TYPES,
  WEBVIEW_TO_EXTENSION_MESSAGE_TYPES,
} from '@scout-agent/shared';
import { getScoutWebviewHtml } from '../src/webview-content.ts';

const tempRoots: string[] = [];
let devServer: http.Server | undefined;

function makeExtensionUri(indexHtml: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-webview-content-'));
  tempRoots.push(root);
  const webviewDist = path.join(root, 'dist', 'webview');
  fs.mkdirSync(webviewDist, { recursive: true });
  fs.writeFileSync(path.join(webviewDist, 'index.html'), indexHtml, 'utf-8');
  return vscode.Uri.file(root);
}

function makeWebview() {
  return {
    asWebviewUri: vi.fn(() => 'vscode-webview://scout/dist/webview'),
  };
}

describe('getScoutWebviewHtml', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    if (devServer) {
      await new Promise<void>((resolve, reject) => {
        devServer?.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      devServer = undefined;
    }
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('injects startup theme background before local webview assets load', async () => {
    const extensionUri = makeExtensionUri(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="stylesheet" href="/assets/index.css">
    <script type="module" src="/assets/index.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>`);
    const webview = makeWebview();

    const html = await getScoutWebviewHtml(extensionUri, webview as never, false, 'chat');

    expect(html).toContain('data-scout-startup-theme');
    expect(html).toContain(
      'var(--vscode-sideBar-background, var(--vscode-editor-background, #252526))',
    );
    expect(html.indexOf('data-scout-startup-theme')).toBeLessThan(
      html.indexOf('href="vscode-webview://scout/dist/webview//assets/index.css"'),
    );
    expect(html).toContain('window.__SCOUT_WEBVIEW_SURFACE__="chat"');
  });

  it('uses typed routing for the HMR iframe protocol bridge', async () => {
    await startDevServerForProbe();
    const extensionUri = makeExtensionUri('<html></html>');
    const webview = makeWebview();

    const html = await getScoutWebviewHtml(extensionUri, webview as never, true, 'settings');

    expect(html).toContain('http://localhost:5173?surface=settings');
    expect(html).toContain('<iframe id="scout-webview-frame"></iframe>');
    expect(html).toContain(JSON.stringify(WEBVIEW_TO_EXTENSION_MESSAGE_TYPES));
    expect(html).toContain(JSON.stringify(EXTENSION_TO_WEBVIEW_MESSAGE_TYPES));
    expect(html).toContain('webviewToExtensionTypes.has(event.data.type)');
    expect(html).toContain('extensionToWebviewTypes.has(event.data.type)');
    expect(html).toContain('event.source === frame.contentWindow && event.origin === devOrigin');
    expect(html.indexOf('if (isFrameMessage(event))')).toBeLessThan(
      html.indexOf('vscode.postMessage(event.data)'),
    );
  });
});

async function startDevServerForProbe(): Promise<void> {
  const server = http.createServer((_req, res) => {
    res.statusCode = 204;
    res.end();
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(5173, '127.0.0.1', resolve);
    });
    devServer = server;
  } catch (error) {
    server.close();
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
    ) {
      return;
    }
    throw error;
  }
}

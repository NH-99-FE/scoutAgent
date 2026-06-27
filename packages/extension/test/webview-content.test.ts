import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { getScoutWebviewHtml } from '../src/webview-content.ts';

const tempRoots: string[] = [];

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
  afterEach(() => {
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
});

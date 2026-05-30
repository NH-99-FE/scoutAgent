import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as http from 'node:http';

const DEV_SERVER_URL = 'http://localhost:5173';

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

class ScoutSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'scout-agent.sidebar';

  private _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _isDev: boolean,
  ) {}

  public async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    const localRoot = vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview');
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [localRoot],
    };

// 开发模式 + dev server 运行中 → 用 iframe 加载，支持 HMR
    if (this._isDev && (await probeDevServer())) {
      webviewView.webview.html = this._getHmrHtml();
    } else {
      webviewView.webview.html = this._getLocalHtml(webviewView.webview);
    }

    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.command) {
        case 'ready':
          console.log('[scout-agent] webview ready');
          break;
      }
    });
  }

  /**
   * HMR 模式：通过 iframe 嵌入 Vite dev server。
   * 外层页面始终是本地文件（不会黑屏），CSP 只需放行 frame-src。
   * Vite 的 HMR 在 iframe 内自然运行。
   */
  private _getHmrHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src http://localhost:5173; style-src 'unsafe-inline';">
  <title>Scout Agent</title>
  <style>
    body { margin: 0; padding: 0; overflow: hidden; height: 100vh; }
    iframe { width: 100%; height: 100%; border: none; }
  </style>
</head>
<body>
  <iframe src="${DEV_SERVER_URL}"></iframe>
</body>
</html>`;
  }

  /** 从本地构建产物加载（生产模式，或 dev server 未启动时的回退） */
  private _getLocalHtml(webview: vscode.Webview): string {
    const webviewDist = path.join(this._extensionUri.fsPath, 'dist', 'webview');
    const indexHtmlPath = path.join(webviewDist, 'index.html');

    if (fs.existsSync(indexHtmlPath)) {
      let html = fs.readFileSync(indexHtmlPath, 'utf-8');
      const webviewUri = webview.asWebviewUri(vscode.Uri.file(webviewDist));
      html = html.replace(
        /(src|href)="([^"]*)"/g,
        (_, attr, src) => `${attr}="${webviewUri}/${src}"`,
      );
      return html;
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Scout Agent</title>
  <style>
    body { font-family: var(--vscode-font-family); padding: 12px; }
    h2 { color: var(--vscode-foreground); }
    p { color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <h2>Scout Agent</h2>
  <p>Webview not built yet. Run <code>pnpm run build</code> in the webview package first.</p>
</body>
</html>`;
  }
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new ScoutSidebarProvider(
    context.extensionUri,
    context.extensionMode === vscode.ExtensionMode.Development,
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ScoutSidebarProvider.viewType, provider),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('scout-agent.openSidebar', () => {
      vscode.commands.executeCommand('workbench.view.extension.scout-agent');
    }),
  );
}

export function deactivate() {}

import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';

class ScoutSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'scout-agent.sidebar';

  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview')],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.command) {
        case 'ready':
          console.log('[scout-agent] webview ready');
          break;
      }
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
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
  const provider = new ScoutSidebarProvider(context.extensionUri);

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

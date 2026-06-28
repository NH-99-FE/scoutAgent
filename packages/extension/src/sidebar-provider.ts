// ============================================================
// Webview 容器 — ScoutSidebarProvider
// 从 extension.ts 拆出，注入 ScoutController 引用
// ============================================================

import * as vscode from 'vscode';
import type { ScoutController } from './scout-controller.ts';
import { configureScoutWebview, getScoutWebviewHtml } from './webview-content.ts';

export class ScoutSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'scout-agent.sidebar';

  private _view?: vscode.WebviewView;
  private readonly _extensionUri: vscode.Uri;
  private readonly _isDev: boolean;
  private readonly _controller: ScoutController;
  private _binding?: vscode.Disposable;

  constructor(extensionUri: vscode.Uri, isDev: boolean, controller: ScoutController) {
    this._extensionUri = extensionUri;
    this._isDev = isDev;
    this._controller = controller;
  }

  public async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    configureScoutWebview(this._extensionUri, webviewView.webview);
    const html = await getScoutWebviewHtml(
      this._extensionUri,
      webviewView.webview,
      this._isDev,
      'chat',
    );

    // 将 chat surface 绑定到 controller 后再写入 HTML，避免 webview 启动脚本的首批请求丢失。
    this._binding?.dispose();
    this._binding = this._controller.bindWebview(webviewView.webview, 'chat');
    webviewView.webview.html = html;
    webviewView.onDidDispose(() => {
      this._binding?.dispose();
      this._binding = undefined;
      if (this._view === webviewView) {
        this._view = undefined;
      }
    });
  }
}

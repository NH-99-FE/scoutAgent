// ============================================================
// Webview Panel Manager — Settings / Tree singleton 面板编排
// ============================================================

import * as vscode from 'vscode';
import type { ScoutController } from './scout-controller.ts';
import type { ScoutWebviewSurface } from './host/webview-surface.ts';
import { configureScoutWebview, getScoutWebviewHtml } from './webview-content.ts';

interface ScoutPanelSpec {
  surface: Exclude<ScoutWebviewSurface, 'chat'>;
  viewType: string;
  title: string;
}

interface ScoutPanelBinding {
  panel: vscode.WebviewPanel;
  webviewBinding: vscode.Disposable;
  disposeListener: vscode.Disposable;
}

type ScoutWebviewHtmlLoader = typeof getScoutWebviewHtml;

type ScoutPanelState =
  | {
      status: 'pending';
      panel: vscode.WebviewPanel;
      opening: Promise<void>;
      disposed: boolean;
      webviewBinding?: vscode.Disposable;
      disposeListener?: vscode.Disposable;
    }
  | {
      status: 'ready';
      binding: ScoutPanelBinding;
    };

const SETTINGS_PANEL: ScoutPanelSpec = {
  surface: 'settings',
  viewType: 'scout-agent.settings',
  title: 'Scout Settings',
};

const TREE_PANEL: ScoutPanelSpec = {
  surface: 'tree',
  viewType: 'scout-agent.tree',
  title: 'Scout Tree',
};

export class ScoutWebviewPanelManager implements vscode.Disposable {
  private readonly extensionUri: vscode.Uri;
  private readonly isDev: boolean;
  private readonly controller: ScoutController;
  private readonly htmlLoader: ScoutWebviewHtmlLoader;
  private settings?: ScoutPanelState;
  private tree?: ScoutPanelState;

  constructor(
    extensionUri: vscode.Uri,
    isDev: boolean,
    controller: ScoutController,
    htmlLoader: ScoutWebviewHtmlLoader = getScoutWebviewHtml,
  ) {
    this.extensionUri = extensionUri;
    this.isDev = isDev;
    this.controller = controller;
    this.htmlLoader = htmlLoader;
  }

  async openSettingsPanel(): Promise<void> {
    await this.openPanel(SETTINGS_PANEL);
  }

  async openTreePanel(): Promise<void> {
    await this.openPanel(TREE_PANEL);
  }

  dispose(): void {
    this.getPanel(this.settings)?.dispose();
    this.getPanel(this.tree)?.dispose();
    this.settings = undefined;
    this.tree = undefined;
  }

  private async openPanel(spec: ScoutPanelSpec): Promise<void> {
    const existing = this.getState(spec.surface);
    if (existing) {
      const panel = this.getPanel(existing);
      panel?.reveal(vscode.ViewColumn.Beside);
      if (existing.status === 'pending') {
        await existing.opening;
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      spec.viewType,
      spec.title,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );
    const pendingState: Extract<ScoutPanelState, { status: 'pending' }> = {
      status: 'pending',
      panel,
      opening: Promise.resolve(),
      disposed: false,
    };
    const disposeListener = panel.onDidDispose(() => {
      pendingState.disposed = true;
      pendingState.webviewBinding?.dispose();
      pendingState.disposeListener?.dispose();
      this.clearState(spec.surface, panel);
    });
    pendingState.disposeListener = disposeListener;
    this.setState(spec.surface, pendingState);

    configureScoutWebview(this.extensionUri, panel.webview);
    pendingState.opening = this.finishPanelOpening(spec, pendingState, disposeListener);
    await pendingState.opening;
  }

  private async finishPanelOpening(
    spec: ScoutPanelSpec,
    pendingState: Extract<ScoutPanelState, { status: 'pending' }>,
    disposeListener: vscode.Disposable,
  ): Promise<void> {
    const panel = pendingState.panel;
    try {
      const html = await this.htmlLoader(
        this.extensionUri,
        panel.webview,
        this.isDev,
        spec.surface,
      );
      if (pendingState.disposed || this.getState(spec.surface) !== pendingState) {
        return;
      }
      panel.webview.html = html;
      const webviewBinding = this.controller.bindWebview(panel.webview, spec.surface);
      pendingState.webviewBinding = webviewBinding;
      this.setState(spec.surface, {
        status: 'ready',
        binding: { panel, webviewBinding, disposeListener },
      });
    } catch (error) {
      this.clearState(spec.surface, panel);
      if (!pendingState.disposed) {
        panel.dispose();
      }
      throw error;
    }
  }

  private getState(surface: ScoutPanelSpec['surface']): ScoutPanelState | undefined {
    return surface === 'settings' ? this.settings : this.tree;
  }

  private setState(surface: ScoutPanelSpec['surface'], state: ScoutPanelState): void {
    if (surface === 'settings') {
      this.settings = state;
    } else {
      this.tree = state;
    }
  }

  private clearState(surface: ScoutPanelSpec['surface'], panel: vscode.WebviewPanel): void {
    const current = this.getState(surface);
    if (this.getPanel(current) !== panel) return;
    if (surface === 'settings') {
      this.settings = undefined;
    } else {
      this.tree = undefined;
    }
  }

  private getPanel(state: ScoutPanelState | undefined): vscode.WebviewPanel | undefined {
    if (!state) return undefined;
    return state.status === 'ready' ? state.binding.panel : state.panel;
  }
}

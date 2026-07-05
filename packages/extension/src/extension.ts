// ============================================================
// Extension 入口 — 组装 Controller + SidebarProvider
// ============================================================

import * as vscode from 'vscode';
import { ScoutController } from './scout-controller.ts';
import { ScoutChangesReviewPanelManager } from './host/review/changes-review-panel.ts';
import { ScoutSidebarProvider } from './sidebar-provider.ts';
import { ScoutWebviewPanelManager } from './webview-panel-manager.ts';

const activeControllers = new Set<ScoutController>();

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('Scout Agent');
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';

  const panelManagerRef: { current?: ScoutWebviewPanelManager } = {};
  const isDev = context.extensionMode === vscode.ExtensionMode.Development;
  const changesReviewPanelManager = new ScoutChangesReviewPanelManager(
    context.extensionUri,
    context.globalState,
    isDev,
  );
  const controller = new ScoutController({
    extensionUri: context.extensionUri,
    outputChannel,
    cwd,
    openSettingsPanel: () => {
      const panelManager = panelManagerRef.current;
      if (!panelManager) throw new Error('Scout panel manager is not initialized');
      return panelManager.openSettingsPanel();
    },
    openTreePanel: () => {
      const panelManager = panelManagerRef.current;
      if (!panelManager) throw new Error('Scout panel manager is not initialized');
      return panelManager.openTreePanel();
    },
    openChangesReviewPanel: (review, options) =>
      changesReviewPanelManager.open({
        review,
        allowCurrentFileContextExpansion: options.allowCurrentFileContextExpansion,
        cwd: options.cwd,
        recordId: options.recordId,
      }),
    openCurrentChangesReviewPanel: (review, options) =>
      changesReviewPanelManager.openCurrent({
        review,
        cwd: options.cwd,
        sessionId: options.sessionId,
      }),
    updateCurrentChangesReviewPanel: (review, options) =>
      changesReviewPanelManager.updateCurrent({
        review,
        cwd: options.cwd,
        sessionId: options.sessionId,
      }),
  });
  activeControllers.add(controller);

  const panelManager = new ScoutWebviewPanelManager(context.extensionUri, isDev, controller);
  panelManagerRef.current = panelManager;
  const provider = new ScoutSidebarProvider(context.extensionUri, isDev, controller);

  context.subscriptions.push(
    {
      dispose: () => {
        activeControllers.delete(controller);
        controller.dispose();
      },
    },
    outputChannel,
    panelManager,
    changesReviewPanelManager,
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ScoutSidebarProvider.viewType, provider),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('scout-agent.openSidebar', () =>
      vscode.commands.executeCommand('workbench.view.extension.scout-agent'),
    ),
    vscode.commands.registerCommand('scout-agent.openSettings', () =>
      panelManager?.openSettingsPanel(),
    ),
    vscode.commands.registerCommand('scout-agent.openTree', () => panelManager?.openTreePanel()),
  );
}

export async function deactivate() {
  const controllers = [...activeControllers];
  activeControllers.clear();
  await Promise.all(
    controllers.map((controller) =>
      typeof controller.disposeAsync === 'function'
        ? controller.disposeAsync()
        : controller.dispose(),
    ),
  );
}

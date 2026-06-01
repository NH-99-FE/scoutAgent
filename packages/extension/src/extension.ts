// ============================================================
// Extension 入口 — 组装 Controller + SidebarProvider
// ============================================================

import * as vscode from 'vscode';
import { ScoutController } from './scout-controller.ts';
import { ScoutSidebarProvider } from './sidebar-provider.ts';

const activeControllers = new Set<ScoutController>();

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('Scout Agent');
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';

  const controller = new ScoutController({
    extensionUri: context.extensionUri,
    outputChannel,
    cwd,
  });
  activeControllers.add(controller);

  const isDev = context.extensionMode === vscode.ExtensionMode.Development;
  const provider = new ScoutSidebarProvider(context.extensionUri, isDev, controller);

  context.subscriptions.push(
    {
      dispose: () => {
        activeControllers.delete(controller);
        controller.dispose();
      },
    },
    outputChannel,
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ScoutSidebarProvider.viewType, provider),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('scout-agent.openSidebar', () =>
      vscode.commands.executeCommand('workbench.view.extension.scout-agent'),
    ),
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

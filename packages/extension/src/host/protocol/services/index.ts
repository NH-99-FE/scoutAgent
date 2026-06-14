// ============================================================
// Protocol services — Webview protocol service 注册入口
// ============================================================

import type { ProtocolServer } from '../protocol-server.ts';
import { registerConfigService } from './config-service.ts';
import { registerLifecycleService } from './lifecycle-service.ts';
import { registerMentionService } from './mention-service.ts';
import { registerSessionService } from './session-service.ts';
import { registerStateService } from './state-service.ts';
import { registerTaskService } from './task-service.ts';
import { registerTreeService } from './tree-service.ts';
import { registerUiService } from './ui-service.ts';
import type {
  ConfigProtocolHost,
  LifecycleProtocolHost,
  MentionProtocolHost,
  SessionProtocolHost,
  StateProtocolHost,
  TaskProtocolHost,
  TreeProtocolHost,
  UiProtocolHost,
} from './types.ts';

// ---------- 类型 ----------

export type { ProtocolResponder } from './types.ts';

export interface ScoutProtocolServices {
  lifecycle: LifecycleProtocolHost;
  state: StateProtocolHost;
  config: ConfigProtocolHost;
  session: SessionProtocolHost;
  task: TaskProtocolHost;
  tree: TreeProtocolHost;
  mention: MentionProtocolHost;
  ui: UiProtocolHost;
}

// ---------- 注册 ----------

export function registerScoutProtocolServices(
  server: ProtocolServer,
  services: ScoutProtocolServices,
): void {
  registerLifecycleService(server, services.lifecycle);
  registerStateService(server, services.state);
  registerConfigService(server, services.config);
  registerSessionService(server, services.session);
  registerTaskService(server, services.task);
  registerTreeService(server, services.tree);
  registerMentionService(server, services.mention);
  registerUiService(server, services.ui);
}

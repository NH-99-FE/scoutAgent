// ============================================================
// Extension templates — Settings 可创建的扩展示例模板
// ============================================================

import type { ScoutExtensionTemplateId } from '@scout-agent/shared';

// ---------- 类型 ----------

export interface ExtensionTemplate {
  id: ScoutExtensionTemplateId;
  label: string;
  fileName: string;
  render: () => string;
}

// ---------- 模板 ----------

export const PERMISSION_GATE_TEMPLATE_ID = 'permission-gate';

const PERMISSION_GATE_TEMPLATE_SOURCE = `// ============================================================
// Permission Gate — Pi 风格危险 bash 命令确认扩展
// ============================================================

interface PermissionGateToolCallEvent {
  toolName: string;
  input: Record<string, unknown>;
}

interface PermissionGateToolCallResult {
  block?: boolean;
  reason?: string;
}

interface PermissionGateUIContext {
  hasUI: boolean;
  signal?: AbortSignal;
  ui: {
    select(
      title: string,
      options: string[],
      settings?: {
        variant?: 'default' | 'danger';
        body?: { kind: 'text' | 'code'; text: string };
        timeout?: number;
        signal?: AbortSignal;
      },
    ): Promise<string | undefined>;
  };
}

interface PermissionGateExtensionAPI {
  on(
    event: 'tool_call',
    handler: (
      event: PermissionGateToolCallEvent,
      ctx: PermissionGateUIContext,
    ) => PermissionGateToolCallResult | undefined | Promise<PermissionGateToolCallResult | undefined>,
  ): void;
}

const dangerousPatterns = [
  /\\brm\\s+(-rf?|--recursive)/i,
  /\\bsudo\\b/i,
  /\\b(chmod|chown)\\b.*777/i,
];

export default function (scout: PermissionGateExtensionAPI) {
  scout.on('tool_call', async (event, ctx) => {
    if (event.toolName !== 'bash') return undefined;

    const command = event.input?.command;
    if (typeof command !== 'string') return undefined;
    if (!dangerousPatterns.some((pattern) => pattern.test(command))) return undefined;

    if (!ctx.hasUI) {
      return {
        block: true,
        reason: 'Dangerous command blocked (no UI for confirmation)',
      };
    }

    const choice = await ctx.ui.select('危险命令', ['Yes', 'No'], {
      variant: 'danger',
      body: { kind: 'code', text: command },
      timeout: 300000,
      signal: ctx.signal,
    });

    if (choice !== 'Yes') {
      return { block: true, reason: 'Blocked by user' };
    }

    return undefined;
  });
}
`;

const EXTENSION_TEMPLATES: Record<ScoutExtensionTemplateId, ExtensionTemplate> = {
  [PERMISSION_GATE_TEMPLATE_ID]: {
    id: PERMISSION_GATE_TEMPLATE_ID,
    label: 'Permission Gate',
    fileName: 'permission-gate.ts',
    render: () => PERMISSION_GATE_TEMPLATE_SOURCE,
  },
};

// ---------- 查询 ----------

export function getExtensionTemplate(templateId: ScoutExtensionTemplateId): ExtensionTemplate {
  return EXTENSION_TEMPLATES[templateId];
}

export function listExtensionTemplates(): ExtensionTemplate[] {
  return Object.values(EXTENSION_TEMPLATES);
}

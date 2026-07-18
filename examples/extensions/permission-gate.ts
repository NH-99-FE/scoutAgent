// ============================================================
// Permission Gate — 危险 bash 命令确认示例扩展
// ============================================================

import type {
  ScoutExtensionContext,
  ScoutExtensionFactory,
  ToolCallEvent,
  ToolCallEventResult,
} from '../../packages/extension/src/core/extensions/index.ts';

const PERMISSION_PROMPT_TIMEOUT_MS = 5 * 60 * 1000;
const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\s+(-rf?|--recursive)/i,
  /\bsudo\b/i,
  /\b(chmod|chown)\b.*777/i,
] as const;

const permissionGateExtension: ScoutExtensionFactory = (scout) => {
  scout.on('tool_call', async (event, ctx) => {
    const toolEvent = event as ToolCallEvent;
    const typedCtx = ctx as ScoutExtensionContext;
    if (toolEvent.toolName !== 'bash') return undefined;

    const command = toolEvent.input.command;
    if (typeof command !== 'string') return undefined;
    if (!DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(command))) {
      return undefined;
    }

    if (!typedCtx.hasUI) {
      return {
        block: true,
        reason: 'Dangerous command blocked (no UI for confirmation)',
      } satisfies ToolCallEventResult;
    }

    const choice = await typedCtx.ui.select('危险命令', ['Yes', 'No'], {
      body: { kind: 'code', text: command },
      signal: typedCtx.signal,
      timeout: PERMISSION_PROMPT_TIMEOUT_MS,
      variant: 'danger',
    });
    if (choice !== 'Yes') {
      return { block: true, reason: 'Blocked by user' } satisfies ToolCallEventResult;
    }

    return undefined;
  });
};

export default permissionGateExtension;

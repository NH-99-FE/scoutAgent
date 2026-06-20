import { describe, expect, it, vi } from 'vitest';
import {
  SCOUT_PROTOCOL,
  type ScoutProtocolService,
  type WebviewRequestPayload,
} from '@scout-agent/shared';
import { ProtocolServer } from '../../../src/host/protocol/protocol-server.ts';
import {
  registerScoutProtocolServices,
  type ScoutProtocolServices,
} from '../../../src/host/protocol/services/index.ts';

interface ProtocolCase<TPayload extends WebviewRequestPayload> {
  payload: TPayload;
  route: {
    service: ScoutProtocolService;
    method: string;
  };
}

function protocolCase<TPayload extends WebviewRequestPayload>(
  payload: TPayload,
  route: ProtocolCase<TPayload>['route'],
): ProtocolCase<TPayload> {
  return { payload, route };
}

const PAYLOAD_CASES = [
  protocolCase({ type: 'ready' }, { service: 'lifecycle', method: 'ready' }),
  protocolCase({ type: 'request_state' }, { service: 'state', method: 'request_state' }),
  protocolCase({ type: 'request_config' }, { service: 'config', method: 'request_config' }),
  protocolCase(
    { type: 'request_context_usage' },
    { service: 'state', method: 'request_context_usage' },
  ),
  protocolCase(
    { type: 'user_message', text: 'hello' },
    { service: 'session', method: 'user_message' },
  ),
  protocolCase(
    { type: 'new_session_message', text: 'hello' },
    { service: 'session', method: 'new_session_message' },
  ),
  protocolCase(
    { type: 'cancel_follow_up', id: 'follow-up-1' },
    { service: 'session', method: 'cancel_follow_up' },
  ),
  protocolCase(
    { type: 'promote_follow_up', id: 'follow-up-1', resume: true },
    { service: 'session', method: 'promote_follow_up' },
  ),
  protocolCase(
    { type: 'compact', customInstructions: 'short' },
    { service: 'session', method: 'compact' },
  ),
  protocolCase(
    { type: 'select_model', provider: 'anthropic', modelId: 'claude-test' },
    { service: 'config', method: 'select_model' },
  ),
  protocolCase(
    { type: 'select_thinking', level: 'off' },
    { service: 'config', method: 'select_thinking' },
  ),
  protocolCase(
    { type: 'set_active_tools', toolNames: [] },
    { service: 'config', method: 'set_active_tools' },
  ),
  protocolCase(
    { type: 'clear_conversation' },
    { service: 'session', method: 'clear_conversation' },
  ),
  protocolCase({ type: 'reload_resources' }, { service: 'config', method: 'reload_resources' }),
  protocolCase({ type: 'open_settings_panel' }, { service: 'ui', method: 'open_settings_panel' }),
  protocolCase({ type: 'open_tree_panel' }, { service: 'ui', method: 'open_tree_panel' }),
  protocolCase(
    { type: 'fork_session', entryId: 'entry-1', position: 'at' },
    { service: 'tree', method: 'fork_session' },
  ),
  protocolCase({ type: 'request_tree' }, { service: 'tree', method: 'request_tree' }),
  protocolCase(
    { type: 'navigate_tree', targetId: 'entry-1', summarize: false },
    { service: 'tree', method: 'navigate_tree' },
  ),
  protocolCase(
    { type: 'set_label', entryId: 'entry-1', label: 'Label' },
    { service: 'tree', method: 'set_label' },
  ),
  protocolCase(
    { type: 'set_session_name', name: 'Session name' },
    { service: 'session', method: 'set_session_name' },
  ),
  protocolCase({ type: 'continue_session' }, { service: 'session', method: 'continue_session' }),
  protocolCase({ type: 'request_commands' }, { service: 'ui', method: 'request_commands' }),
  protocolCase(
    { type: 'request_file_mentions', query: 'src', limit: 10 },
    { service: 'mention', method: 'request_file_mentions' },
  ),
  protocolCase(
    { type: 'request_task_history', query: '', offset: 0, purpose: 'panel' },
    { service: 'task', method: 'request_task_history' },
  ),
  protocolCase(
    {
      type: 'open_task',
      taskId: 'task-1',
      sessionPath: '/workspace/.scout/sessions/task-1.jsonl',
    },
    { service: 'session', method: 'open_task' },
  ),
  protocolCase({ type: 'request_sessions' }, { service: 'session', method: 'request_sessions' }),
  protocolCase(
    {
      type: 'restore_session',
      sessionId: 'session-1',
      sessionPath: '/workspace/.scout/sessions/session-1.jsonl',
    },
    { service: 'session', method: 'restore_session' },
  ),
  protocolCase(
    { type: 'pick_import_session' },
    { service: 'session', method: 'pick_import_session' },
  ),
  protocolCase(
    { type: 'import_session', sessionPath: '/workspace/import.jsonl' },
    { service: 'session', method: 'import_session' },
  ),
  protocolCase(
    {
      type: 'delete_session',
      sessionId: 'session-1',
      sessionPath: '/workspace/.scout/sessions/session-1.jsonl',
    },
    { service: 'session', method: 'delete_session' },
  ),
  protocolCase(
    { type: 'export_session', format: 'jsonl' },
    { service: 'session', method: 'export_session' },
  ),
];

type SampledPayloadType = (typeof PAYLOAD_CASES)[number]['payload']['type'];
type MissingPayloadType = Exclude<WebviewRequestPayload['type'], SampledPayloadType>;

const exhaustivePayloadCoverage: Record<MissingPayloadType, never> = {};

function makeServices(): ScoutProtocolServices {
  return {
    lifecycle: {
      ready: vi.fn(async () => undefined),
    },
    state: {
      pushState: vi.fn(async () => undefined),
      requestState: vi.fn(async () => undefined),
      requestContextUsage: vi.fn(async () => undefined),
    },
    config: {
      pushConfig: vi.fn(),
      requestConfig: vi.fn(),
      setModel: vi.fn(async () => undefined),
      setThinkingLevel: vi.fn(async () => undefined),
      setActiveTools: vi.fn(),
      reloadResources: vi.fn(async (respond) => {
        respond({ type: 'reload_result', success: true });
      }),
    },
    session: {
      userMessage: vi.fn(async () => undefined),
      newSessionMessage: vi.fn(async (_message, respond) => {
        respond({ type: 'new_session_result', success: true });
      }),
      cancelFollowUp: vi.fn(),
      promoteFollowUp: vi.fn(async () => undefined),
      compact: vi.fn(async () => undefined),
      continueSession: vi.fn(async () => undefined),
      clearConversation: vi.fn(),
      requestSessions: vi.fn(async () => undefined),
      openTask: vi.fn(async (message, respond) => {
        respond({
          type: 'open_task_result',
          sessionPath: message.sessionPath,
          success: true,
        });
      }),
      restoreSession: vi.fn(async (_message, respond) => {
        respond({ type: 'restore_session_result', success: true });
      }),
      pickImportSession: vi.fn(async (respond) => {
        respond({ type: 'import_session_result', success: true });
      }),
      importSession: vi.fn(async (_message, respond) => {
        respond({ type: 'import_session_result', success: true });
      }),
      deleteSession: vi.fn(async (_message, respond) => {
        respond({ type: 'delete_session_result', success: true });
      }),
      exportSession: vi.fn((_message, respond) => {
        respond({ type: 'export_session_result', success: true, path: '/workspace/export.jsonl' });
      }),
      setSessionName: vi.fn(async (_message, respond) => {
        respond({ type: 'set_session_name_result', success: true });
      }),
    },
    task: {
      requestTaskHistory: vi.fn(async (message, respond) => {
        respond({
          type: 'task_history_result',
          query: message.query,
          purpose: message.purpose,
          tasks: [],
          offset: message.offset ?? 0,
          hasMore: false,
          nextOffset: message.offset ?? 0,
        });
      }),
    },
    tree: {
      forkSession: vi.fn(async () => undefined),
      requestTree: vi.fn(async () => undefined),
      navigateTree: vi.fn(async (_message, respond) => {
        respond({ type: 'navigate_tree_result', success: true });
      }),
      setLabel: vi.fn(async (_message, respond) => {
        respond({ type: 'label_result', success: true });
      }),
    },
    mention: {
      requestFileMentions: vi.fn(async () => undefined),
    },
    ui: {
      requestCommands: vi.fn(),
      openSettingsPanel: vi.fn(async (respond) => {
        respond({ type: 'open_settings_panel_result', success: true });
      }),
      openTreePanel: vi.fn(async (respond) => {
        respond({ type: 'open_tree_panel_result', success: true });
      }),
    },
  };
}

describe('registerScoutProtocolServices', () => {
  it('registers a handler for every routed webview payload', async () => {
    expect(exhaustivePayloadCoverage).toEqual({});

    const postMessage = vi.fn();
    const server = new ProtocolServer({ postMessage });
    registerScoutProtocolServices(server, makeServices());

    for (const { payload, route } of PAYLOAD_CASES) {
      postMessage.mockClear();
      await server.handleRequest(
        {
          type: 'protocol_request',
          requestId: `request:${payload.type}`,
          service: route.service,
          method: route.method,
          payload,
        },
        SCOUT_PROTOCOL[payload.type].surfaces?.[0] ?? 'chat',
      );

      const errorResponse = postMessage.mock.calls
        .map(([message]) => message)
        .find((message) => message.type === 'protocol_response' && message.error);
      expect(errorResponse).toBeUndefined();
    }
  });
});

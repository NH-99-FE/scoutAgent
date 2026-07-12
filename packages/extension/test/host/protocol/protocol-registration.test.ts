import { describe, expect, it, vi } from 'vitest';
import {
  SCOUT_PROTOCOL,
  type ScoutProtocolService,
  type WebviewRequestPayload,
} from '@scout-agent/shared';
import { ProtocolServer } from '../../../src/host/protocol/protocol-server.ts';
import { validateWebviewRequestPayload } from '../../../src/host/protocol/protocol-payload-guards.ts';
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
    { type: 'request_custom_models' },
    { service: 'config', method: 'request_custom_models' },
  ),
  protocolCase(
    { type: 'request_runtime_settings' },
    { service: 'config', method: 'request_runtime_settings' },
  ),
  protocolCase(
    { type: 'request_extensions' },
    { service: 'extensions', method: 'request_extensions' },
  ),
  protocolCase({ type: 'request_skills' }, { service: 'skills', method: 'request_skills' }),
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
    { type: 'set_default_model', provider: 'anthropic', modelId: 'claude-test', scope: 'global' },
    { service: 'config', method: 'set_default_model' },
  ),
  protocolCase(
    {
      type: 'save_custom_models',
      settings: {
        providers: {
          openai: {
            apiKey: '',
            baseUrl: 'https://api.openai.com/v1',
            api: 'openai-completions',
            models: [
              {
                id: 'gpt-test',
                name: 'GPT Test',
                api: 'openai-completions',
                baseUrl: 'https://api.openai.com/v1',
                reasoning: false,
                input: ['text'],
                contextWindow: 1000,
                maxTokens: 100,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              },
            ],
            modelOverrides: {},
          },
        },
      },
    },
    { service: 'config', method: 'save_custom_models' },
  ),
  protocolCase(
    {
      type: 'save_runtime_settings',
      scope: 'global',
      patch: {
        operations: [
          { op: 'set', path: 'defaultProvider', value: 'openai' },
          { op: 'set', path: 'defaultModel', value: 'gpt-test' },
        ],
      },
    },
    { service: 'config', method: 'save_runtime_settings' },
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
  protocolCase(
    { type: 'create_extension_from_template', templateId: 'permission-gate', scope: 'project' },
    { service: 'extensions', method: 'create_extension_from_template' },
  ),
  protocolCase(
    { type: 'open_extension_file', path: '/workspace/.scout/extensions/permission-gate.ts' },
    { service: 'extensions', method: 'open_extension_file' },
  ),
  protocolCase(
    {
      type: 'save_skills_settings',
      scope: 'project',
      entries: ['./skills'],
      toggles: [{ path: '/workspace/.scout/skills/review/SKILL.md', enabled: false }],
    },
    { service: 'skills', method: 'save_skills_settings' },
  ),
  protocolCase(
    { type: 'open_skill_file', path: '/workspace/.scout/skills/review/SKILL.md' },
    { service: 'skills', method: 'open_skill_file' },
  ),
  protocolCase({ type: 'open_settings_panel' }, { service: 'ui', method: 'open_settings_panel' }),
  protocolCase({ type: 'open_tree_panel' }, { service: 'ui', method: 'open_tree_panel' }),
  protocolCase({ type: 'copy_text', text: 'hello' }, { service: 'ui', method: 'copy_text' }),
  protocolCase(
    {
      type: 'download_image',
      data: 'aW1hZ2U=',
      mimeType: 'image/png',
      fileName: 'screenshot.png',
    },
    { service: 'ui', method: 'download_image' },
  ),
  protocolCase(
    { type: 'open_changes_review', turnId: 'turn-1' },
    { service: 'ui', method: 'open_changes_review' },
  ),
  protocolCase(
    { type: 'open_current_changes_review' },
    { service: 'ui', method: 'open_current_changes_review' },
  ),
  protocolCase(
    { type: 'fork_session', entryId: 'entry-1', position: 'at' },
    { service: 'tree', method: 'fork_session' },
  ),
  protocolCase(
    { type: 'request_fork_candidates', sessionId: 'session-1' },
    { service: 'tree', method: 'request_fork_candidates' },
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
    { type: 'extension_ui_response', id: 'approval-1', action: 'confirm' },
    { service: 'ui', method: 'extension_ui_response' },
  ),
  protocolCase(
    { type: 'pick_composer_content', selectionKind: 'file' },
    { service: 'mention', method: 'pick_composer_content' },
  ),
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
      requestCustomModels: vi.fn((respond) => {
        respond({
          type: 'custom_models_result',
          settings: {
            modelsPath: '/home/me/.scout/agent/models.json',
            providerMetadata: {
              openai: {
                provider: 'openai',
                defaultBaseUrl: 'https://api.openai.com/v1',
                defaultApi: 'openai-completions',
                supportedApis: ['openai-completions', 'openai-responses'],
              },
              anthropic: {
                provider: 'anthropic',
                defaultBaseUrl: 'https://api.anthropic.com',
                defaultApi: 'anthropic-messages',
                supportedApis: ['anthropic-messages'],
              },
            },
            providers: {
              openai: {
                apiKey: '',
                baseUrl: 'https://api.openai.com/v1',
                api: 'openai-completions',
                models: [],
                modelOverrides: {},
              },
              anthropic: {
                apiKey: '',
                baseUrl: 'https://api.anthropic.com',
                api: 'anthropic-messages',
                models: [],
                modelOverrides: {},
              },
            },
          },
        });
      }),
      requestRuntimeSettings: vi.fn((respond) => {
        respond({
          type: 'runtime_settings_result',
          settings: {
            globalSettingsPath: '/home/me/.scout/agent/settings.json',
            projectSettingsPath: '/workspace/.scout/settings.json',
            global: {},
            project: {},
            effective: {},
          },
        });
      }),
      setModel: vi.fn(async () => undefined),
      setDefaultModel: vi.fn(async (_message, respond) => {
        respond({ type: 'set_default_model_result', success: true });
      }),
      saveCustomModels: vi.fn(async (_message, respond) => {
        respond({ type: 'save_custom_models_result', success: true });
      }),
      saveRuntimeSettings: vi.fn(async (_message, respond) => {
        respond({ type: 'save_runtime_settings_result', success: true });
      }),
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
      exportSession: vi.fn(async (_message, respond) => {
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
      requestForkCandidates: vi.fn(async (message, respond) => {
        respond({ type: 'fork_candidates_result', sessionId: message.sessionId, candidates: [] });
      }),
      requestTree: vi.fn(async () => undefined),
      navigateTree: vi.fn(async (_message, respond) => {
        respond({ type: 'navigate_tree_result', success: true });
      }),
      setLabel: vi.fn(async (_message, respond) => {
        respond({ type: 'label_result', success: true });
      }),
    },
    mention: {
      pickComposerContent: vi.fn(async () => undefined),
      requestFileMentions: vi.fn(async () => undefined),
    },
    extensions: {
      requestExtensions: vi.fn(async (respond) => {
        respond({
          type: 'extensions_result',
          settings: {
            projectDir: '/workspace/.scout/extensions',
            globalDir: '/home/me/.scout/agent/extensions',
            configuredPaths: [],
            templates: [
              {
                id: 'permission-gate',
                label: 'Permission Gate',
                path: '/workspace/.scout/extensions/permission-gate.ts',
                exists: false,
              },
            ],
            extensions: [],
          },
        });
      }),
      createExtensionFromTemplate: vi.fn(async (_message, respond) => {
        respond({
          type: 'create_extension_from_template_result',
          success: true,
          path: '/workspace/.scout/extensions/permission-gate.ts',
        });
      }),
      openExtensionFile: vi.fn(async (message, respond) => {
        respond({ type: 'open_extension_file_result', success: true, path: message.path });
      }),
    },
    skills: {
      requestSkills: vi.fn(async (respond) => {
        respond({
          type: 'skills_result',
          settings: {
            projectDir: '/workspace/.scout/skills',
            globalDir: '/home/me/.scout/agent/skills',
            agentsDirs: ['/workspace/.agents/skills'],
            globalEntries: [],
            projectEntries: ['./skills'],
            configuredPaths: ['/workspace/.scout/skills'],
            diagnostics: [],
            skills: [],
          },
        });
      }),
      saveSkillsSettings: vi.fn(async (_message, respond) => {
        respond({ type: 'save_skills_settings_result', success: true });
      }),
      openSkillFile: vi.fn(async (message, respond) => {
        respond({ type: 'open_skill_file_result', success: true, path: message.path });
      }),
    },
    ui: {
      requestCommands: vi.fn(),
      extensionUIResponse: vi.fn(),
      openSettingsPanel: vi.fn(async (respond) => {
        respond({ type: 'open_settings_panel_result', success: true });
      }),
      openTreePanel: vi.fn(async (respond) => {
        respond({ type: 'open_tree_panel_result', success: true });
      }),
      copyText: vi.fn(async (_message, respond) => {
        respond({ type: 'copy_text_result', success: true });
      }),
      downloadImage: vi.fn(async (_message, respond) => {
        respond({
          type: 'download_image_result',
          success: true,
          path: '/workspace/screenshot.png',
        });
      }),
      openChangesReview: vi.fn(async (_message, respond) => {
        respond({ type: 'open_changes_review_result', success: true });
      }),
      openCurrentChangesReview: vi.fn(async (respond) => {
        respond({ type: 'open_current_changes_review_result', success: true });
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

  it('rejects custom model snapshot fields at the protocol boundary', () => {
    const payload = {
      type: 'save_custom_models',
      settings: {
        modelsPath: '/home/me/.scout/agent/models.json',
        providerMetadata: {},
        providers: {},
      },
    };

    expect(validateWebviewRequestPayload(payload).error).toContain(
      'settings.modelsPath is not a protocol field',
    );
  });

  it('lets manager-level custom model validation pass thin protocol shape validation', () => {
    const payload = {
      type: 'save_custom_models',
      settings: {
        providers: {
          openai: {
            apiKey: '',
            baseUrl: 'https://api.openai.com/v1',
            api: 'anthropic-messages',
            models: [
              {
                id: 'gpt-test',
                name: 'GPT Test',
                api: 'anthropic-messages',
                baseUrl: 'https://api.openai.com/v1',
                reasoning: false,
                input: ['text'],
                contextWindow: 0,
                maxTokens: 100,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              },
            ],
            modelOverrides: {},
          },
        },
      },
    };

    expect(validateWebviewRequestPayload(payload)).toMatchObject({ ok: true, error: '' });
  });

  it('validates extension UI response actions at the protocol boundary', () => {
    for (const payload of [
      { type: 'extension_ui_response', id: 'approval-1', action: 'confirm' },
      { type: 'extension_ui_response', id: 'approval-1', action: 'cancel' },
      { type: 'extension_ui_response', id: 'approval-1', action: 'select', value: 'Yes' },
      { type: 'extension_ui_response', id: 'approval-1', action: 'input', value: 'Scout' },
    ]) {
      expect(validateWebviewRequestPayload(payload)).toMatchObject({ ok: true, error: '' });
    }

    expect(
      validateWebviewRequestPayload({
        type: 'extension_ui_response',
        id: 'approval-1',
        action: 'select',
      }),
    ).toMatchObject({
      ok: false,
      error: 'extension_ui_response.value must be a string',
    });
    expect(
      validateWebviewRequestPayload({
        type: 'extension_ui_response',
        id: 'approval-1',
        action: 'cancel',
        value: 'ignored',
      }),
    ).toMatchObject({
      ok: false,
      error: 'extension_ui_response.value is not allowed for this action',
    });
  });

  it('rejects invalid runtime setting patch values at the protocol boundary', () => {
    const payload = {
      type: 'save_runtime_settings',
      scope: 'global',
      patch: {
        operations: [{ op: 'set', path: 'defaultProvider', value: 'openrouter' }],
      },
    };

    expect(validateWebviewRequestPayload(payload)).toMatchObject({
      ok: false,
      error: expect.stringContaining('defaultProvider must be one of openai, anthropic'),
    });
  });
});

import { describe, expect, it } from 'vitest';
import type { WebviewRequestPayload } from '@scout-agent/shared';
import { resolveProtocolRoute, type ProtocolRoute } from '@/bridge/protocol-route';

interface ProtocolCase<TPayload extends WebviewRequestPayload> {
  payload: TPayload;
  route: ProtocolRoute;
}

function protocolCase<TPayload extends WebviewRequestPayload>(
  payload: TPayload,
  route: ProtocolRoute,
): ProtocolCase<TPayload> {
  return { payload, route };
}

const ROUTE_CASES = [
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

type SampledPayloadType = (typeof ROUTE_CASES)[number]['payload']['type'];
type MissingPayloadType = Exclude<WebviewRequestPayload['type'], SampledPayloadType>;

const exhaustivePayloadCoverage: Record<MissingPayloadType, never> = {};

describe('resolveProtocolRoute', () => {
  it('maps every webview request payload to an extension service route', () => {
    expect(exhaustivePayloadCoverage).toEqual({});

    for (const { payload, route } of ROUTE_CASES) {
      expect(resolveProtocolRoute(payload)).toEqual(route);
    }
  });
});

// ============================================================
// Protocol payload guards — Webview request payload 运行时校验
// 负责：在 host 边界拒绝字段类型错误、未知字段和非法枚举值。
// ============================================================

import type { ScoutProtocolPayloadType, WebviewRequestPayload } from '@scout-agent/shared';

// ---------- 类型 ----------

export interface ProtocolPayloadGuardResult {
  ok: boolean;
  payload?: WebviewRequestPayload;
  error: string;
}

type PayloadValidator = (payload: Record<string, unknown>) => string | undefined;

// ---------- 校验入口 ----------

export function validateWebviewRequestPayload(
  payload: Record<string, unknown>,
): ProtocolPayloadGuardResult {
  const type = payload.type;
  if (typeof type !== 'string' || !isKnownPayloadType(type)) {
    return { ok: false, error: `Unknown payload type: ${String(type)}` };
  }

  const error = PAYLOAD_VALIDATORS[type](payload);
  if (error) {
    return { ok: false, error: `${type}.${error}` };
  }
  return { ok: true, payload: payload as unknown as WebviewRequestPayload, error: '' };
}

// ---------- Payload validators ----------

const PAYLOAD_VALIDATORS = {
  ready: fields('type'),
  request_state: fields('type'),
  request_config: fields('type'),
  request_context_usage: fields('type'),
  user_message: combine(
    fields('type', 'text', 'images', 'deliverAs', 'clearFollowUpQueue'),
    requiredString('text'),
    optionalImages('images'),
    optionalEnum('deliverAs', ['steer', 'followUp']),
    optionalBoolean('clearFollowUpQueue'),
  ),
  new_session_message: combine(
    fields('type', 'text', 'images'),
    requiredString('text'),
    optionalImages('images'),
  ),
  cancel_follow_up: combine(fields('type', 'id'), requiredString('id')),
  promote_follow_up: combine(
    fields('type', 'id', 'resume', 'preserveFollowUpQueue'),
    requiredString('id'),
    optionalBoolean('resume'),
    optionalBoolean('preserveFollowUpQueue'),
  ),
  compact: combine(fields('type', 'customInstructions'), optionalString('customInstructions')),
  select_model: combine(
    fields('type', 'provider', 'modelId'),
    requiredString('provider'),
    requiredString('modelId'),
  ),
  select_thinking: combine(
    fields('type', 'level'),
    requiredEnum('level', ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']),
  ),
  set_active_tools: combine(fields('type', 'toolNames'), requiredStringArray('toolNames')),
  clear_conversation: fields('type'),
  reload_resources: fields('type'),
  open_settings_panel: fields('type'),
  open_tree_panel: fields('type'),
  fork_session: combine(
    fields('type', 'entryId', 'position'),
    requiredString('entryId'),
    requiredEnum('position', ['before', 'at']),
  ),
  request_tree: fields('type'),
  navigate_tree: combine(
    fields('type', 'targetId', 'summarize', 'customInstructions', 'replaceInstructions', 'label'),
    requiredString('targetId'),
    requiredBoolean('summarize'),
    optionalString('customInstructions'),
    optionalBoolean('replaceInstructions'),
    optionalString('label'),
  ),
  set_label: combine(
    fields('type', 'entryId', 'label'),
    requiredString('entryId'),
    optionalString('label'),
  ),
  set_session_name: combine(fields('type', 'name'), requiredString('name')),
  continue_session: combine(
    fields('type', 'preserveFollowUpQueue'),
    optionalBoolean('preserveFollowUpQueue'),
  ),
  request_commands: fields('type'),
  request_file_mentions: combine(
    fields('type', 'query', 'limit'),
    requiredString('query'),
    optionalInteger('limit'),
  ),
  request_task_history: combine(
    fields('type', 'query', 'limit', 'offset', 'scope', 'purpose'),
    requiredString('query'),
    optionalInteger('limit'),
    optionalInteger('offset'),
    optionalEnum('scope', ['workspace', 'all']),
    optionalEnum('purpose', ['recent', 'panel']),
  ),
  open_task: combine(
    fields('type', 'taskId', 'sessionPath', 'cwdOverride'),
    requiredString('taskId'),
    requiredString('sessionPath'),
    optionalString('cwdOverride'),
  ),
  request_sessions: fields('type'),
  restore_session: combine(
    fields('type', 'sessionId', 'sessionPath', 'cwdOverride'),
    requiredString('sessionId'),
    requiredString('sessionPath'),
    optionalString('cwdOverride'),
  ),
  pick_import_session: fields('type'),
  import_session: combine(
    fields('type', 'sessionPath', 'cwdOverride'),
    requiredString('sessionPath'),
    optionalString('cwdOverride'),
  ),
  delete_session: combine(
    fields('type', 'sessionId', 'sessionPath'),
    requiredString('sessionId'),
    requiredString('sessionPath'),
  ),
  export_session: combine(
    fields('type', 'format', 'outputPath'),
    requiredEnum('format', ['jsonl']),
    optionalString('outputPath'),
  ),
} satisfies Record<ScoutProtocolPayloadType, PayloadValidator>;

// ---------- Primitive validators ----------

function combine(...validators: PayloadValidator[]): PayloadValidator {
  return (payload) => {
    for (const validator of validators) {
      const error = validator(payload);
      if (error) return error;
    }
    return undefined;
  };
}

function fields(...allowedKeys: string[]): PayloadValidator {
  const allowed = new Set(allowedKeys);
  return (payload) => {
    for (const key of Object.keys(payload)) {
      if (!allowed.has(key)) {
        return `${key} is not a protocol field`;
      }
    }
    return undefined;
  };
}

function requiredString(key: string): PayloadValidator {
  return (payload) => (typeof payload[key] === 'string' ? undefined : `${key} must be a string`);
}

function optionalString(key: string): PayloadValidator {
  return (payload) =>
    payload[key] === undefined || typeof payload[key] === 'string'
      ? undefined
      : `${key} must be a string when provided`;
}

function requiredBoolean(key: string): PayloadValidator {
  return (payload) => (typeof payload[key] === 'boolean' ? undefined : `${key} must be a boolean`);
}

function optionalBoolean(key: string): PayloadValidator {
  return (payload) =>
    payload[key] === undefined || typeof payload[key] === 'boolean'
      ? undefined
      : `${key} must be a boolean when provided`;
}

function optionalInteger(key: string): PayloadValidator {
  return (payload) =>
    payload[key] === undefined ||
    (typeof payload[key] === 'number' && Number.isInteger(payload[key]))
      ? undefined
      : `${key} must be an integer when provided`;
}

function requiredStringArray(key: string): PayloadValidator {
  return (payload) =>
    Array.isArray(payload[key]) && payload[key].every((item) => typeof item === 'string')
      ? undefined
      : `${key} must be a string array`;
}

function requiredEnum(key: string, values: readonly string[]): PayloadValidator {
  return (payload) =>
    typeof payload[key] === 'string' && values.includes(payload[key])
      ? undefined
      : `${key} must be one of ${values.join(', ')}`;
}

function optionalEnum(key: string, values: readonly string[]): PayloadValidator {
  return (payload) =>
    payload[key] === undefined ||
    (typeof payload[key] === 'string' && values.includes(payload[key]))
      ? undefined
      : `${key} must be one of ${values.join(', ')} when provided`;
}

function optionalImages(key: string): PayloadValidator {
  return (payload) => {
    const value = payload[key];
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) return `${key} must be an image array when provided`;
    for (const [index, item] of value.entries()) {
      if (!isRecord(item)) return `${key}[${index}] must be an object`;
      const fieldError = fields('type', 'data', 'mimeType')(item);
      if (fieldError) return `${key}[${index}].${fieldError}`;
      if (item.type !== 'image') return `${key}[${index}].type must be image`;
      if (typeof item.data !== 'string') return `${key}[${index}].data must be a string`;
      if (typeof item.mimeType !== 'string') {
        return `${key}[${index}].mimeType must be a string`;
      }
    }
    return undefined;
  };
}

function isKnownPayloadType(type: string): type is ScoutProtocolPayloadType {
  return type in PAYLOAD_VALIDATORS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

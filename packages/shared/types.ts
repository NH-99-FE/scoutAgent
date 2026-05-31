// ============================================================
// Shared message protocol between Extension and Webview
// 纯通信契约 —— 两端运行时之间的消息格式
// 不引入任何包的内部类型，所有类型都自包含且可序列化
// ============================================================

// ---------- Thinking levels ----------

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high';

// ---------- Webview → Extension ----------

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'user_message'; text: string }
  | { type: 'abort' }
  | { type: 'select_model'; modelId: string }
  | { type: 'select_thinking'; level: ThinkingLevel }
  | { type: 'clear_conversation' };

// ---------- 消息内容块 ----------

export interface ScoutTextContent {
  type: 'text';
  text: string;
}

export interface ScoutThinkingContent {
  type: 'thinking';
  thinking: string;
  redacted?: boolean;
}

export interface ScoutToolCallContent {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ScoutContent = ScoutTextContent | ScoutThinkingContent | ScoutToolCallContent;

// ---------- 可序列化消息 ----------

export interface ScoutUserMessage {
  role: 'user';
  content: string | ScoutContent[];
  timestamp: number;
}

export interface ScoutAssistantMessage {
  role: 'assistant';
  content: ScoutContent[];
  stopReason?: string;
  errorMessage?: string;
  timestamp: number;
}

export interface ScoutToolResultMessage {
  role: 'toolResult';
  toolCallId: string;
  toolName: string;
  content: ScoutTextContent[];
  isError: boolean;
  timestamp: number;
}

export type ScoutMessage = ScoutUserMessage | ScoutAssistantMessage | ScoutToolResultMessage;

// ---------- Extension → Webview ----------

export interface ScoutWebviewState {
  messages: ScoutMessage[];
  isStreaming: boolean;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  errorMessage?: string;
}

export interface ScoutConfig {
  models: { id: string; name: string }[];
  defaultModelId: string;
}

/**
 * Agent 事件在 postMessage 通道上的序列化形式。
 * 结构与内部 AgentEvent 对齐，消息类型替换为可序列化的 ScoutMessage。
 * Extension 端负责将内部 AgentEvent 映射为此格式。
 */
export type ScoutAgentEvent =
  | { type: 'agent_start' }
  | { type: 'agent_end' }
  | { type: 'turn_start' }
  | { type: 'turn_end' }
  | { type: 'message_start'; message: ScoutMessage }
  | { type: 'message_update'; message: ScoutMessage }
  | { type: 'message_end'; message: ScoutMessage }
  | {
      type: 'tool_execution_start';
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | { type: 'tool_execution_update'; toolCallId: string; toolName: string; partialResult: string }
  | {
      type: 'tool_execution_end';
      toolCallId: string;
      toolName: string;
      result: string;
      isError: boolean;
    };

export type ExtensionMessage =
  | { type: 'state_update'; state: ScoutWebviewState }
  | { type: 'agent_event'; event: ScoutAgentEvent }
  | { type: 'config_update'; config: ScoutConfig };

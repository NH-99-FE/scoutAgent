// ============================================================
// event-mapper — AgentEvent → ScoutAgentEvent
// Scout 独有：将内部 agent 事件映射为可序列化的 postMessage 格式
// Extension 端调用此函数后通过 postMessage 发送给 Webview
// ============================================================

import type {
  AssistantMessage,
  ImageContent,
  TextContent,
  ToolResultMessage,
  UserMessage,
} from '@scout-agent/ai';
import type {
  ScoutAgentEvent,
  ScoutAssistantMessage,
  ScoutBranchSummaryMessage,
  ScoutCompactionSummaryMessage,
  ScoutContent,
  ScoutCustomMessage,
  ScoutMessage,
  ScoutTextContent,
  ScoutToolResultMessage,
  ScoutUserMessage,
} from '@scout-agent/shared';
import type {
  AgentEvent,
  AgentMessage,
  BranchSummaryMessage,
  CompactionSummaryMessage,
  CustomMessage,
} from '@scout-agent/agent';

// ---------- 内容块转换 ----------

function convertAssistantContent(content: AssistantMessage['content']): ScoutContent[] {
  return content.flatMap((block): ScoutContent[] => {
    if (block.type === 'text') {
      return [{ type: 'text', text: block.text }];
    }
    if (block.type === 'thinking') {
      return [{ type: 'thinking', thinking: block.thinking, redacted: block.redacted }];
    }
    if (block.type === 'toolCall') {
      return [
        {
          type: 'toolCall',
          id: block.id,
          name: block.name,
          arguments: block.arguments as Record<string, unknown>,
        },
      ];
    }
    return [];
  });
}

function convertUserContent(content: UserMessage['content']): string | ScoutContent[] {
  if (typeof content === 'string') return content;
  return content.flatMap((block): ScoutContent[] => {
    if (block.type === 'text') return [{ type: 'text', text: block.text }];
    if (block.type === 'image') {
      return [{ type: 'image', data: block.data, mimeType: block.mimeType }];
    }
    return [];
  });
}

function convertCustomContent(
  content: string | (TextContent | ImageContent)[],
): string | ScoutContent[] {
  if (typeof content === 'string') return content;
  return content.flatMap((block): ScoutContent[] => {
    if (block.type === 'text') return [{ type: 'text', text: block.text }];
    if (block.type === 'image') {
      return [{ type: 'image', data: block.data, mimeType: block.mimeType }];
    }
    return [];
  });
}

function convertToolResultContent(content: ToolResultMessage['content']): ScoutTextContent[] {
  return content.flatMap((block): ScoutTextContent[] => {
    if (block.type === 'text') return [{ type: 'text', text: block.text }];
    return [];
  });
}

// ---------- AgentMessage → ScoutMessage ----------

export function convertMessage(message: AgentMessage): ScoutMessage | null {
  if (message.role === 'user') {
    const msg = message as UserMessage;
    const scoutMsg: ScoutUserMessage = {
      role: 'user',
      content: convertUserContent(msg.content),
      timestamp: msg.timestamp,
    };
    return scoutMsg;
  }

  if (message.role === 'assistant') {
    const msg = message as AssistantMessage;
    const scoutMsg: ScoutAssistantMessage = {
      role: 'assistant',
      content: convertAssistantContent(msg.content),
      stopReason: msg.stopReason,
      errorMessage: msg.errorMessage,
      timestamp: msg.timestamp,
    };
    return scoutMsg;
  }

  if (message.role === 'toolResult') {
    const msg = message as ToolResultMessage;
    const scoutMsg: ScoutToolResultMessage = {
      role: 'toolResult',
      toolCallId: msg.toolCallId,
      toolName: msg.toolName,
      content: convertToolResultContent(msg.content),
      isError: msg.isError,
      timestamp: msg.timestamp,
    };
    return scoutMsg;
  }

  if (message.role === 'branchSummary') {
    const msg = message as BranchSummaryMessage;
    const scoutMsg: ScoutBranchSummaryMessage = {
      role: 'branchSummary',
      summary: msg.summary,
      fromId: msg.fromId,
      timestamp: msg.timestamp,
    };
    return scoutMsg;
  }

  if (message.role === 'compactionSummary') {
    const msg = message as CompactionSummaryMessage;
    const scoutMsg: ScoutCompactionSummaryMessage = {
      role: 'compactionSummary',
      summary: msg.summary,
      tokensBefore: msg.tokensBefore,
      timestamp: msg.timestamp,
    };
    return scoutMsg;
  }

  if (message.role === 'custom') {
    const msg = message as CustomMessage;
    if (!msg.display) return null;
    const scoutMsg: ScoutCustomMessage = {
      role: 'custom',
      customType: msg.customType,
      content: convertCustomContent(msg.content),
      details: msg.details,
      timestamp: msg.timestamp,
    };
    return scoutMsg;
  }

  return null;
}

// ---------- AgentToolResult → string ----------

function toolResultToString(result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const r = result as { content?: unknown[] };
  if (!Array.isArray(r.content)) return '';
  return r.content
    .filter(
      (c): c is TextContent =>
        typeof c === 'object' && c !== null && (c as Record<string, unknown>).type === 'text',
    )
    .map((c) => c.text)
    .join('');
}

// ---------- 主映射函数 ----------

/**
 * 将内部 AgentEvent 映射为可序列化的 ScoutAgentEvent。
 * 对于携带无法序列化的自定义消息类型的事件，返回 null。
 */
export function mapAgentEventToScout(event: AgentEvent): ScoutAgentEvent | null {
  switch (event.type) {
    case 'agent_start':
      return { type: 'agent_start' };

    case 'agent_end':
      return {
        type: 'agent_end',
        willRetry: (event as { willRetry?: boolean }).willRetry ?? false,
      };

    case 'turn_start':
      return { type: 'turn_start' };

    case 'turn_end':
      return { type: 'turn_end' };

    case 'message_start': {
      const message = convertMessage(event.message);
      if (!message) return null;
      return { type: 'message_start', message };
    }

    case 'message_update': {
      const message = convertMessage(event.message);
      if (!message) return null;
      return { type: 'message_update', message };
    }

    case 'message_end': {
      const message = convertMessage(event.message);
      if (!message) return null;
      return { type: 'message_end', message };
    }

    case 'tool_execution_start':
      return {
        type: 'tool_execution_start',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args as Record<string, unknown>,
      };

    case 'tool_execution_update':
      return {
        type: 'tool_execution_update',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        partialResult: toolResultToString(event.partialResult),
      };

    case 'tool_execution_end':
      return {
        type: 'tool_execution_end',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        result: toolResultToString(event.result),
        isError: event.isError,
      };
  }

  return null;
}

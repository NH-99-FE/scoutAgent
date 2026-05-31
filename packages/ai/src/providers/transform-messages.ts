// ============================================================
// 消息变换 — 跨供应商兼容性处理
// 从 Pi 的 providers/transform-messages.ts 移植
//
// 处理内容：
// 1. 不支持图片的模型降级图片
// 2. thinking 块兼容性（redacted thinking、跨模型）
// 3. 工具调用 ID 规范化
// 4. 孤立工具调用的合成 tool result 补全
// 5. 跳过 error/aborted 的 assistant 消息
// ============================================================

import type {
  Api,
  AssistantMessage,
  ImageContent,
  Message,
  Model,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
} from '../types';

const NON_VISION_USER_IMAGE_PLACEHOLDER = '(image omitted: model does not support images)';
const NON_VISION_TOOL_IMAGE_PLACEHOLDER = '(tool image omitted: model does not support images)';

function replaceImagesWithPlaceholder(
  content: (TextContent | ImageContent)[],
  placeholder: string,
): TextContent[] {
  const result: TextContent[] = [];
  let previousWasPlaceholder = false;

  for (const block of content) {
    if (block.type === 'image') {
      if (!previousWasPlaceholder) {
        result.push({ type: 'text', text: placeholder });
      }
      previousWasPlaceholder = true;
      continue;
    }

    result.push(block);
    previousWasPlaceholder = block.text === placeholder;
  }

  return result;
}

function downgradeUnsupportedImages<TApi extends Api>(
  messages: Message[],
  model: Model<TApi>,
): Message[] {
  if (model.input.includes('image')) {
    return messages;
  }

  return messages.map((msg) => {
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      return {
        ...msg,
        content: replaceImagesWithPlaceholder(msg.content, NON_VISION_USER_IMAGE_PLACEHOLDER),
      };
    }

    if (msg.role === 'toolResult') {
      return {
        ...msg,
        content: replaceImagesWithPlaceholder(msg.content, NON_VISION_TOOL_IMAGE_PLACEHOLDER),
      };
    }

    return msg;
  });
}

/**
 * 跨供应商兼容的消息变换。
 * 规范化工具调用 ID — OpenAI Responses API 生成含特殊字符的长 ID，
 * Anthropic API 要求 ID 匹配 ^[a-zA-Z0-9_-]+$（最长 64 字符）。
 */
export function transformMessages<TApi extends Api>(
  messages: Message[],
  model: Model<TApi>,
  normalizeToolCallId?: (id: string, model: Model<TApi>, source: AssistantMessage) => string,
): Message[] {
  // 建立原始工具调用 ID 到规范化 ID 的映射
  const toolCallIdMap = new Map<string, string>();
  const imageAwareMessages = downgradeUnsupportedImages(messages, model);

  // 第一遍：变换消息（图片降级、thinking 块、工具调用 ID 规范化）
  const transformed = imageAwareMessages.map((msg) => {
    // 用户消息直接透传
    if (msg.role === 'user') {
      return msg;
    }

    // 处理 toolResult 消息 — 如有映射则规范化 toolCallId
    if (msg.role === 'toolResult') {
      const normalizedId = toolCallIdMap.get(msg.toolCallId);
      if (normalizedId && normalizedId !== msg.toolCallId) {
        return { ...msg, toolCallId: normalizedId };
      }
      return msg;
    }

    // assistant 消息需要变换检查
    if (msg.role === 'assistant') {
      const assistantMsg = msg as AssistantMessage;
      const isSameModel =
        assistantMsg.provider === model.provider &&
        assistantMsg.api === model.api &&
        assistantMsg.model === model.id;

      const transformedContent: (TextContent | ThinkingContent | ToolCall)[] =
        assistantMsg.content.flatMap((block): (TextContent | ThinkingContent | ToolCall)[] => {
          if (block.type === 'thinking') {
            // redacted thinking 是不透明加密内容，仅对同一模型有效
            // 跨模型时丢弃以避免 API 错误
            if (block.redacted) {
              return isSameModel ? [block] : [];
            }
            // 同一模型：保留带签名的 thinking 块（回放需要）
            // 即使 thinking 文本为空（OpenAI 加密推理）
            if (isSameModel && block.thinkingSignature) return [block];
            // 跳过空 thinking 块，其他转为纯文本
            if (!block.thinking || block.thinking.trim() === '') return [];
            if (isSameModel) return [block];
            return [
              {
                type: 'text' as const,
                text: block.thinking,
              },
            ];
          }

          if (block.type === 'text') {
            if (isSameModel) return [block];
            return [
              {
                type: 'text' as const,
                text: block.text,
              },
            ];
          }

          if (block.type === 'toolCall') {
            const toolCall = block as ToolCall;
            let normalizedToolCall: ToolCall = toolCall;

            if (!isSameModel && (toolCall as any).thoughtSignature) {
              normalizedToolCall = { ...toolCall };
              delete (normalizedToolCall as { thoughtSignature?: string }).thoughtSignature;
            }

            if (!isSameModel && normalizeToolCallId) {
              const normalizedId = normalizeToolCallId(toolCall.id, model, assistantMsg);
              if (normalizedId !== toolCall.id) {
                toolCallIdMap.set(toolCall.id, normalizedId);
                normalizedToolCall = { ...normalizedToolCall, id: normalizedId };
              }
            }

            return [normalizedToolCall];
          }

          return [block];
        });

      return {
        ...assistantMsg,
        content: transformedContent,
      } as AssistantMessage;
    }
    return msg;
  });

  // 第二遍：为孤立的工具调用插入合成空 tool result
  // 保留 thinking 签名并满足 API 要求
  const result: Message[] = [];
  let pendingToolCalls: ToolCall[] = [];
  let existingToolResultIds = new Set<string>();

  const insertSyntheticToolResults = () => {
    if (pendingToolCalls.length > 0) {
      for (const tc of pendingToolCalls) {
        if (!existingToolResultIds.has(tc.id)) {
          result.push({
            role: 'toolResult',
            toolCallId: tc.id,
            toolName: tc.name,
            content: [{ type: 'text', text: 'No result provided' }],
            isError: true,
            timestamp: Date.now(),
          } as ToolResultMessage);
        }
      }
      pendingToolCalls = [];
      existingToolResultIds = new Set();
    }
  };

  for (let i = 0; i < transformed.length; i++) {
    const msg = transformed[i];

    if (msg.role === 'assistant') {
      // 如果前一个 assistant 有孤立的工具调用，现在插入合成结果
      insertSyntheticToolResults();

      // 完全跳过 error/aborted 的 assistant 消息
      // 这些是不完整的轮次，不应被回放：
      // - 可能有部分内容（没有消息的推理、不完整的工具调用）
      // - 回放会导致 API 错误（例如 OpenAI "reasoning without following item"）
      // - 模型应从上一个有效状态重试
      const assistantMsg = msg as AssistantMessage;
      if (assistantMsg.stopReason === 'error' || assistantMsg.stopReason === 'aborted') {
        continue;
      }

      // 追踪此 assistant 消息中的工具调用
      const toolCalls = assistantMsg.content.filter((b) => b.type === 'toolCall') as ToolCall[];
      if (toolCalls.length > 0) {
        pendingToolCalls = toolCalls;
        existingToolResultIds = new Set();
      }

      result.push(msg);
    } else if (msg.role === 'toolResult') {
      existingToolResultIds.add(msg.toolCallId);
      result.push(msg);
    } else if (msg.role === 'user') {
      // 用户消息打断工具流 — 为孤立的调用插入合成结果
      insertSyntheticToolResults();
      result.push(msg);
    } else {
      result.push(msg);
    }
  }

  // 如果对话以未解决的工具调用结束，现在合成结果
  insertSyntheticToolResults();

  return result;
}

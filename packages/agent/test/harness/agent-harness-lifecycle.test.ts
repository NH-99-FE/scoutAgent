import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  type AssistantMessage,
  type AssistantMessageEvent,
  createAssistantMessageEventStream,
  type Context,
  EventStream,
  type Model,
  registerApiProvider,
  type SimpleStreamOptions,
  type StreamFunction,
  type ToolCall,
  unregisterApiProviders,
} from '@scout-agent/ai';
import { AgentHarness } from '../../src/harness/agent-harness.ts';
import { NodeExecutionEnv } from '../../src/harness/env/nodejs.ts';
import { JsonlSessionStorage } from '../../src/harness/session/jsonl-storage.ts';
import { InMemorySessionStorage } from '../../src/harness/session/memory-storage.ts';
import { Session } from '../../src/harness/session/session.ts';
import type { ExecutionEnv, PromptTemplate, Skill } from '../../src/harness/types.ts';
import type { AgentEvent, AgentMessage, AgentTool } from '../../src/types.ts';
import { createTempDir } from './session-test-utils.ts';

type HarnessWithEventHandler = {
  handleAgentEvent(event: AgentEvent): Promise<void>;
};

interface AppSkill extends Skill {
  source: 'project' | 'user';
}

interface AppPromptTemplate extends PromptTemplate {
  source: 'project' | 'user';
}

interface AppTool extends AgentTool {
  source: 'builtin' | 'extension';
}

type HarnessInternals = {
  phase: 'idle' | 'turn' | 'compacting' | 'branching';
  handleAgentEvent(event: AgentEvent): Promise<void>;
  executeTurn(turnState: unknown, text: string): Promise<AgentMessage>;
  createStreamFn(getTurnState: unknown): unknown;
  followUpQueue: AgentMessage[];
  nextTurnQueue: AgentMessage[];
  executePromptMessages(
    turnState: unknown,
    messages: AgentMessage[],
    options: { skipInitialSteeringPoll?: boolean; missingAssistantLabel: string },
  ): Promise<AgentMessage>;
};

const SOURCE_ID = 'agent-harness-lifecycle-test';

type TestApi = 'test-lifecycle-api';
type ResponseFactory = (
  context: Context,
  options: SimpleStreamOptions | undefined,
  model: Model<TestApi>,
) => AssistantMessage | Promise<AssistantMessage>;

function makeModel(): Model<'anthropic-messages'> {
  return {
    id: 'test-model',
    name: 'Test Model',
    api: 'anthropic-messages',
    provider: 'anthropic',
    baseUrl: 'https://example.com',
    reasoning: false,
    input: ['text'],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 200000,
    maxTokens: 4096,
  };
}

function makeProviderModel(id = 'test-model', reasoning = false): Model<TestApi> {
  return {
    id,
    name: 'Test Model',
    api: 'test-lifecycle-api',
    provider: 'test-provider',
    baseUrl: 'https://example.com',
    reasoning,
    input: ['text'],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 200000,
    maxTokens: 4096,
  };
}

function makeAssistantMessage(): AgentMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'original' }],
    timestamp: 1,
    stopReason: 'stop',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  } as AgentMessage;
}

function makeProviderAssistantMessage(
  textOrContent: string | Array<{ type: 'text'; text: string } | ToolCall>,
  overrides?: Partial<AssistantMessage>,
): AssistantMessage {
  return {
    role: 'assistant',
    content:
      typeof textOrContent === 'string' ? [{ type: 'text', text: textOrContent }] : textOrContent,
    api: 'test-lifecycle-api',
    provider: 'test-provider',
    model: 'test-model',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeToolUseAssistantMessage(): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'toolCall', id: 'tool-1', name: 'echo', arguments: { text: 'hello' } }],
    api: 'test-lifecycle-api',
    provider: 'test-provider',
    model: 'test-model',
    timestamp: 10,
    stopReason: 'toolUse',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

function makeAssistantTextMessage(text: string, timestamp: number): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'test-lifecycle-api',
    provider: 'test-provider',
    model: 'test-model',
    timestamp,
    stopReason: 'stop',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

function makeUserMessage(text: string): AgentMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp: 2,
  };
}

function textFromUserMessages(messages: Array<{ role: string; content: unknown }>): string[] {
  return messages.flatMap((message) => {
    if (message.role !== 'user') return [];
    if (typeof message.content === 'string') return [message.content];
    if (!Array.isArray(message.content)) return [];
    return message.content.flatMap((part) => {
      if (!part || typeof part !== 'object' || !('type' in part) || part.type !== 'text') return [];
      return 'text' in part && typeof part.text === 'string' ? [part.text] : [];
    });
  });
}

function getReasoning(options: unknown): unknown {
  if (!options || typeof options !== 'object' || !('reasoning' in options)) return undefined;
  return options.reasoning;
}

function makeAssistantStream(
  message: AssistantMessage,
): EventStream<AssistantMessageEvent, AssistantMessage> {
  const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
    (event) => event.type === 'done' || event.type === 'error',
    (event) => {
      if (event.type === 'done') return event.message;
      if (event.type === 'error') return event.error;
      throw new Error(`Unexpected event type: ${event.type}`);
    },
  );
  queueMicrotask(() => {
    pushDone(stream, message);
  });
  return stream;
}

function pushDone(
  stream: EventStream<AssistantMessageEvent, AssistantMessage>,
  message: AssistantMessage,
): void {
  if (message.stopReason === 'error' || message.stopReason === 'aborted') {
    stream.push({ type: 'error', reason: message.stopReason, error: message });
    return;
  }
  stream.push({ type: 'done', reason: message.stopReason, message });
}

function registerResponses(responses: ResponseFactory[]): void {
  const streamSimple: StreamFunction<TestApi, SimpleStreamOptions> = (model, context, options) => {
    const response = responses.shift();
    if (!response) throw new Error('No test response queued');
    const stream = createAssistantMessageEventStream();
    queueMicrotask(async () => {
      const message = await response(context, options, model);
      pushDone(stream, message);
    });
    return stream;
  };

  registerApiProvider(
    {
      api: 'test-lifecycle-api',
      stream: streamSimple,
      streamSimple,
    },
    SOURCE_ID,
  );
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const calculateTool: AgentTool = {
  name: 'calculate',
  label: 'Calculate',
  description: 'Calculate expression',
  parameters: {
    type: 'object',
    properties: { expression: { type: 'string' } },
    required: ['expression'],
  },
  execute: async (_toolCallId, input) => ({
    content: [{ type: 'text', text: String((input as { expression: string }).expression) }],
    details: input,
  }),
};

const getCurrentTimeTool: AgentTool = {
  name: 'get_current_time',
  label: 'Get current time',
  description: 'Get current time',
  parameters: {
    type: 'object',
    properties: {},
  },
  execute: async () => ({
    content: [{ type: 'text', text: 'now' }],
    details: {},
  }),
};

function makeHarness(session: Session): AgentHarness {
  return new AgentHarness({
    env: {} as unknown as ExecutionEnv,
    session,
    model: makeModel(),
    systemPrompt: 'test',
  });
}

function hookReplacement(harness: AgentHarness): void {
  harness.on('message_end', (event) => {
    if (event.type !== 'message_end') return;
    const mutableMessage = event.message as unknown as Record<string, unknown>;
    mutableMessage.content = [{ type: 'text', text: 'replacement' }];
    mutableMessage.timestamp = 2;
    return undefined;
  });
}

async function handleMessageEnd(harness: AgentHarness, message: AgentMessage): Promise<void> {
  await (harness as unknown as HarnessWithEventHandler).handleAgentEvent({
    type: 'message_end',
    message,
  });
}

describe('AgentHarness lifecycle', () => {
  afterEach(() => {
    unregisterApiProviders(SOURCE_ID);
  });

  it('constructs directly and exposes queue modes', async () => {
    const session = new Session(new InMemorySessionStorage());
    const env = new NodeExecutionEnv({ cwd: process.cwd() });
    const initialModel = makeModel();
    const harness = new AgentHarness({
      env,
      session,
      model: initialModel,
      thinkingLevel: 'high',
      systemPrompt: 'You are helpful.',
      steeringMode: 'all',
      followUpMode: 'all',
    });

    expect(harness.env).toBe(env);
    expect(harness.getModel()).toBe(initialModel);
    expect(harness.getThinkingLevel()).toBe('high');
    expect(harness.getSteeringMode()).toBe('all');
    expect(harness.getFollowUpMode()).toBe('all');

    await harness.setSteeringMode('one-at-a-time');
    await harness.setFollowUpMode('one-at-a-time');

    expect(harness.getSteeringMode()).toBe('one-at-a-time');
    expect(harness.getFollowUpMode()).toBe('one-at-a-time');
  });

  it('hydrates existing session context when appending before first runtime use', async () => {
    const session = new Session(new InMemorySessionStorage());
    await session.appendMessage(makeUserMessage('existing request'));
    await session.appendMessage(makeProviderAssistantMessage('existing answer'));
    const capturedUserTexts: string[][] = [];
    registerResponses([
      (context) => {
        capturedUserTexts.push(textFromUserMessages(context.messages));
        return makeProviderAssistantMessage('continued');
      },
    ]);
    const harness = new AgentHarness({
      env: new NodeExecutionEnv({ cwd: process.cwd() }),
      session,
      model: makeProviderModel(),
      systemPrompt: 'test',
    });

    await harness.appendMessage(makeUserMessage('new tail'));
    await harness.continue();

    expect(capturedUserTexts).toEqual([['existing request', 'new tail']]);
  });

  it('appends before_agent_start messages and persists them', async () => {
    let requestText: string[] = [];
    registerResponses([
      (context) => {
        requestText = textFromUserMessages(context.messages);
        return makeProviderAssistantMessage('ok');
      },
    ]);
    const session = new Session(new InMemorySessionStorage());
    const harness = new AgentHarness({
      env: new NodeExecutionEnv({ cwd: process.cwd() }),
      session,
      model: makeProviderModel(),
    });
    harness.on('before_agent_start', () => ({
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hook' }], timestamp: Date.now() },
      ],
    }));

    await harness.prompt('hello');

    const persistedText = (await session.getEntries()).flatMap((entry) => {
      if (entry.type !== 'message' || entry.message.role !== 'user') return [];
      const content = entry.message.content;
      if (typeof content === 'string') return [content];
      return content.flatMap((part) => (part.type === 'text' ? [part.text] : []));
    });
    expect(requestText).toEqual(['hello', 'hook']);
    expect(persistedText).toEqual(['hello', 'hook']);
  });

  it('drains one queued steering message at a time and emits queue updates', async () => {
    const userCounts: number[] = [];
    registerResponses([
      (context) => {
        userCounts.push(context.messages.filter((message) => message.role === 'user').length);
        return makeProviderAssistantMessage('first');
      },
      (context) => {
        userCounts.push(context.messages.filter((message) => message.role === 'user').length);
        return makeProviderAssistantMessage('second');
      },
      (context) => {
        userCounts.push(context.messages.filter((message) => message.role === 'user').length);
        return makeProviderAssistantMessage('third');
      },
    ]);
    const harness = new AgentHarness({
      env: new NodeExecutionEnv({ cwd: process.cwd() }),
      session: new Session(new InMemorySessionStorage()),
      model: makeProviderModel(),
      steeringMode: 'one-at-a-time',
    });
    const steerQueueLengths: number[] = [];
    let queued = false;
    harness.subscribe((event) => {
      if (event.type === 'queue_update') {
        steerQueueLengths.push(event.steer.length);
      }
      if (event.type === 'message_start' && event.message.role === 'assistant' && !queued) {
        queued = true;
        void harness.steer('one');
        void harness.steer('two');
      }
    });

    await harness.prompt('hello');

    expect(userCounts).toEqual([1, 2, 3]);
    expect(steerQueueLengths).toEqual([1, 2, 1, 0]);
  });

  it('drains follow-up messages one at a time after the agent would otherwise stop', async () => {
    const userCounts: number[] = [];
    registerResponses([
      (context) => {
        userCounts.push(context.messages.filter((message) => message.role === 'user').length);
        return makeProviderAssistantMessage('first');
      },
      (context) => {
        userCounts.push(context.messages.filter((message) => message.role === 'user').length);
        return makeProviderAssistantMessage('second');
      },
      (context) => {
        userCounts.push(context.messages.filter((message) => message.role === 'user').length);
        return makeProviderAssistantMessage('third');
      },
    ]);
    const harness = new AgentHarness({
      env: new NodeExecutionEnv({ cwd: process.cwd() }),
      session: new Session(new InMemorySessionStorage()),
      model: makeProviderModel(),
      followUpMode: 'one-at-a-time',
    });
    const followUpQueueLengths: number[] = [];
    let queued = false;
    harness.subscribe((event) => {
      if (event.type === 'queue_update') {
        followUpQueueLengths.push(event.followUp.length);
      }
      if (event.type === 'message_start' && event.message.role === 'assistant' && !queued) {
        queued = true;
        void harness.followUp('one');
        void harness.followUp('two');
      }
    });

    await harness.prompt('hello');

    expect(userCounts).toEqual([1, 2, 3]);
    expect(followUpQueueLengths).toEqual([1, 2, 1, 0]);
  });

  it('injects queued next-turn messages into the next prompt', async () => {
    const requestText: string[][] = [];
    const settledNextTurnCounts: number[] = [];
    registerResponses([
      (context) => {
        requestText.push(textFromUserMessages(context.messages));
        return makeProviderAssistantMessage('done');
      },
    ]);
    const harness = new AgentHarness({
      env: new NodeExecutionEnv({ cwd: process.cwd() }),
      session: new Session(new InMemorySessionStorage()),
      model: makeProviderModel(),
    });
    harness.subscribe((event) => {
      if (event.type === 'settled') {
        settledNextTurnCounts.push(event.nextTurnCount);
      }
    });

    await harness.nextTurn('next');

    expect(harness.hasPendingMessages()).toBe(false);

    await harness.prompt('prompt');

    expect(requestText).toEqual([['next', 'prompt']]);
    expect(harness.hasPendingMessages()).toBe(false);
    expect(settledNextTurnCounts).toEqual([0]);
  });

  it('abort clears steer and follow-up queues but preserves next-turn messages', async () => {
    let releaseFirstResponse: (() => void) | undefined;
    let abortedSignal: AbortSignal | undefined;
    const firstResponseReleased = new Promise<void>((resolve) => {
      releaseFirstResponse = resolve;
    });
    const secondRequestText: string[] = [];
    registerResponses([
      async (_context, options) => {
        abortedSignal = options?.signal;
        await firstResponseReleased;
        return makeProviderAssistantMessage('aborted-ish');
      },
      (context) => {
        secondRequestText.push(...textFromUserMessages(context.messages));
        return makeProviderAssistantMessage('second');
      },
    ]);
    const harness = new AgentHarness({
      env: new NodeExecutionEnv({ cwd: process.cwd() }),
      session: new Session(new InMemorySessionStorage()),
      model: makeProviderModel(),
    });
    const queueUpdates: Array<{ steer: number; followUp: number; nextTurn: number }> = [];
    harness.subscribe((event) => {
      if (event.type === 'queue_update') {
        queueUpdates.push({
          steer: event.steer.length,
          followUp: event.followUp.length,
          nextTurn: event.nextTurn.length,
        });
      }
    });

    const firstPrompt = harness.prompt('first');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await harness.steer('steer');
    await harness.followUp('follow');
    await harness.nextTurn('next');
    const abortResultPromise = harness.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(abortedSignal?.aborted).toBe(true);
    releaseFirstResponse?.();
    const abortResult = await abortResultPromise;
    await firstPrompt;
    await harness.prompt('second');

    expect(abortResult.clearedSteer).toHaveLength(1);
    expect(abortResult.clearedFollowUp).toHaveLength(1);
    expect(queueUpdates).toContainEqual({ steer: 0, followUp: 0, nextTurn: 1 });
    expect(secondRequestText).toEqual(['first', 'next', 'second']);
  });

  it('settles thrown hook failures with persisted assistant error messages', async () => {
    registerResponses([() => makeProviderAssistantMessage('should not be used')]);
    const session = new Session(new InMemorySessionStorage());
    const harness = new AgentHarness({
      env: new NodeExecutionEnv({ cwd: process.cwd() }),
      session,
      model: makeProviderModel(),
    });
    const events: string[] = [];
    harness.subscribe((event) => {
      events.push(event.type);
    });
    harness.on('context', () => {
      throw new Error('context exploded');
    });

    const response = await harness.prompt('hello');
    await expect(harness.prompt('after failure')).resolves.toMatchObject({ role: 'assistant' });

    const entries = await session.getEntries();
    const messages = entries.flatMap((entry) => (entry.type === 'message' ? [entry.message] : []));
    expect(response.stopReason).toBe('error');
    expect(response.errorMessage).toBe('context exploded');
    expect(messages[0]?.role).toBe('user');
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      stopReason: 'error',
      errorMessage: 'context exploded',
    });
    expect(events).toContain('agent_end');
    expect(events).toContain('settled');
  });

  it('refreshes model, thinking level, resources, system prompt, and active tools at save points', async () => {
    const firstModel = makeProviderModel('first', true);
    const secondModel = makeProviderModel('second', true);
    const captured: Array<{
      modelId: string;
      reasoning: unknown;
      systemPrompt: string;
      tools: string[];
    }> = [];
    registerResponses([
      (context, options, model) => {
        captured.push({
          modelId: model.id,
          reasoning: getReasoning(options),
          systemPrompt: context.systemPrompt ?? '',
          tools: context.tools?.map((tool) => tool.name) ?? [],
        });
        return makeProviderAssistantMessage(
          [
            {
              type: 'toolCall',
              id: 'call-1',
              name: 'calculate',
              arguments: { expression: '1 + 1' },
            },
          ],
          { stopReason: 'toolUse' },
        );
      },
      (context, options, model) => {
        captured.push({
          modelId: model.id,
          reasoning: getReasoning(options),
          systemPrompt: context.systemPrompt ?? '',
          tools: context.tools?.map((tool) => tool.name) ?? [],
        });
        return makeProviderAssistantMessage('done');
      },
    ]);
    const harness = new AgentHarness<Skill, PromptTemplate, AgentTool>({
      env: new NodeExecutionEnv({ cwd: process.cwd() }),
      session: new Session(new InMemorySessionStorage()),
      model: firstModel,
      thinkingLevel: 'off',
      resources: {
        skills: [
          {
            name: 'prompt',
            description: 'prompt',
            content: 'first prompt',
            filePath: '/skills/prompt',
          },
        ],
      },
      systemPrompt: ({ resources }) => resources.skills?.[0]?.content ?? 'missing prompt',
      tools: [calculateTool],
    });
    harness.subscribe((event) => {
      if (event.type === 'tool_execution_start') {
        void harness.setModel(secondModel);
        void harness.setThinkingLevel('high');
        void harness.setResources({
          skills: [
            {
              name: 'prompt',
              description: 'prompt',
              content: 'second prompt',
              filePath: '/skills/prompt',
            },
          ],
        });
        void harness.setTools([calculateTool, getCurrentTimeTool], [getCurrentTimeTool.name]);
      }
    });

    await harness.prompt('hello');

    expect(captured).toEqual([
      {
        modelId: 'first',
        reasoning: undefined,
        systemPrompt: 'first prompt',
        tools: ['calculate'],
      },
      {
        modelId: 'second',
        reasoning: 'high',
        systemPrompt: 'second prompt',
        tools: ['get_current_time'],
      },
    ]);
  });

  it('preserves app resource types for getters and update events', async () => {
    const session = new Session(new InMemorySessionStorage());
    const env = new NodeExecutionEnv({ cwd: process.cwd() });
    const harness = new AgentHarness<AppSkill, AppPromptTemplate, AppTool>({
      env,
      session,
      model: makeModel(),
    });
    const skill: AppSkill = {
      name: 'inspect',
      description: 'Inspect things',
      content: 'Use inspection tools.',
      filePath: '/skills/inspect/SKILL.md',
      source: 'project',
    };
    const promptTemplate: AppPromptTemplate = {
      name: 'review',
      content: 'Review $1',
      source: 'user',
    };
    const resources = { skills: [skill], promptTemplates: [promptTemplate] };
    const updates: Array<{ resourcesSource?: string; previousSource?: string }> = [];
    harness.subscribe((event) => {
      if (event.type === 'resources_update') {
        updates.push({
          resourcesSource: event.resources.skills?.[0]?.source,
          previousSource: event.previousResources.skills?.[0]?.source,
        });
      }
    });

    await harness.setResources(resources);
    await harness.setResources(resources);
    const resolved = harness.getResources();

    expect(updates).toEqual([
      { resourcesSource: 'project', previousSource: undefined },
      { resourcesSource: 'project', previousSource: 'project' },
    ]);
    expect(resolved.skills?.[0]?.source).toBe('project');
    expect(resolved.promptTemplates?.[0]?.source).toBe('user');
    expect(resolved.skills).not.toBe(resources.skills);
    expect(resolved.promptTemplates).not.toBe(resources.promptTemplates);
  });

  it('persists message_end hook replacements', async () => {
    const session = new Session(new InMemorySessionStorage());
    const harness = makeHarness(session);
    const message = makeAssistantMessage();

    hookReplacement(harness);
    await handleMessageEnd(harness, message);

    const context = await session.buildContext();
    expect(context.messages).toHaveLength(1);
    expect(context.messages[0]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'replacement' }],
      timestamp: 2,
    });
  });

  it('persists message_end hook replacements to JSONL reloads', async () => {
    const dir = createTempDir();
    const env = new NodeExecutionEnv({ cwd: dir });
    const filePath = join(dir, 'session.jsonl');
    const storage = await JsonlSessionStorage.create(env, filePath, {
      cwd: dir,
      sessionId: 'session-1',
    });
    const session = new Session(storage);
    const harness = makeHarness(session);
    const message = makeAssistantMessage();

    hookReplacement(harness);
    await handleMessageEnd(harness, message);

    const reloaded = new Session(await JsonlSessionStorage.open(env, filePath));
    const context = await reloaded.buildContext();
    expect(context.messages).toHaveLength(1);
    expect(context.messages[0]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'replacement' }],
      timestamp: 2,
    });
  });

  it('notifies message_end subscribers after finalized message persistence', async () => {
    const session = new Session(new InMemorySessionStorage());
    const harness = makeHarness(session);
    const message = makeAssistantMessage();
    let observedMessages: AgentMessage[] | undefined;

    hookReplacement(harness);
    harness.subscribe(async (event) => {
      if (event.type !== 'message_end') return;
      const context = await session.buildContext();
      observedMessages = context.messages;
    });

    await handleMessageEnd(harness, message);

    expect(observedMessages).toHaveLength(1);
    expect(observedMessages?.[0]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'replacement' }],
      timestamp: 2,
    });
  });

  it('keeps finalized message persisted when a message_end subscriber fails', async () => {
    const session = new Session(new InMemorySessionStorage());
    const harness = makeHarness(session);
    const message = makeAssistantMessage();

    hookReplacement(harness);
    harness.subscribe((event) => {
      if (event.type === 'message_end') throw new Error('subscriber failed');
    });

    await expect(handleMessageEnd(harness, message)).rejects.toThrow('subscriber failed');

    const context = await session.buildContext();
    expect(context.messages).toHaveLength(1);
    expect(context.messages[0]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'replacement' }],
      timestamp: 2,
    });
  });

  it('rejects message_end replacements with mismatched roles before persistence', async () => {
    const session = new Session(new InMemorySessionStorage());
    const harness = makeHarness(session);
    const message = makeAssistantMessage();

    harness.on('message_end', () => ({
      message: makeUserMessage('wrong role'),
    }));

    await expect(handleMessageEnd(harness, message)).rejects.toThrow(
      'message_end replacement role mismatch',
    );
    expect(await session.getEntries()).toEqual([]);
  });

  it('supports message_end replacements with non-cloneable details', async () => {
    const session = new Session(new InMemorySessionStorage());
    const harness = makeHarness(session);
    const message = makeAssistantMessage();
    const marker = () => 'details marker';
    const replacement = {
      ...makeAssistantMessage(),
      content: [{ type: 'text', text: 'replacement with details' }],
      details: { marker },
    } as AgentMessage;

    harness.on('message_end', () => ({ message: replacement }));

    await handleMessageEnd(harness, message);

    const entries = await session.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: 'message',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'replacement with details' }],
      },
    });
    const messageEntry = entries[0] as {
      message: { details: { marker: { ok: boolean } } };
    };
    expect(messageEntry.message.details.marker).toBe(marker);
  });

  it('orders pending listener session writes after finalized agent messages', async () => {
    const session = new Session(new InMemorySessionStorage());
    const harness = makeHarness(session);
    const internals = harness as unknown as HarnessInternals;
    const assistant = makeAssistantMessage();

    internals.phase = 'turn';
    harness.subscribe(async (event) => {
      if (event.type !== 'message_end' || event.message.role !== 'assistant') return;
      await harness.appendMessage({
        role: 'custom',
        customType: 'listener',
        content: 'listener write',
        display: true,
        timestamp: 3,
      } as AgentMessage);
    });

    await internals.handleAgentEvent({ type: 'message_end', message: assistant });
    await internals.handleAgentEvent({ type: 'turn_end', message: assistant, toolResults: [] });

    const entries = await session.getEntries();
    const roles = entries.flatMap((entry) =>
      entry.type === 'message' ? [entry.message.role] : [],
    );
    expect(roles).toEqual(['assistant', 'custom']);
  });

  it('preserves pending message order before finalized custom messages', async () => {
    const session = new Session(new InMemorySessionStorage());
    const harness = makeHarness(session);
    const internals = harness as unknown as HarnessInternals;
    const userMessage: AgentMessage = {
      role: 'user',
      content: [{ type: 'text', text: 'queued user' }],
      timestamp: 1,
    };
    const customMessage: AgentMessage = {
      role: 'custom',
      customType: 'before-agent-start',
      content: 'queued custom',
      display: true,
      timestamp: 2,
    };

    internals.phase = 'turn';
    await harness.appendMessage(userMessage);
    await internals.handleAgentEvent({ type: 'message_end', message: customMessage });
    await internals.handleAgentEvent({
      type: 'turn_end',
      message: customMessage,
      toolResults: [],
    });

    const entries = await session.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      type: 'message',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'queued user' }],
      },
    });
    expect(entries[1]).toMatchObject({
      type: 'custom_message',
      customType: 'before-agent-start',
      content: 'queued custom',
    });
  });

  it('waitForIdle waits for awaited agent_end listeners and settled notifications', async () => {
    const session = new Session(new InMemorySessionStorage());
    const harness = makeHarness(session);
    const internals = harness as unknown as HarnessInternals;
    const barrier = createDeferred();
    const assistant = makeAssistantMessage();
    const order: string[] = [];

    internals.executeTurn = async () => {
      await internals.handleAgentEvent({ type: 'agent_end', messages: [assistant] });
      return assistant;
    };
    harness.subscribe(async (event) => {
      if (event.type === 'agent_end') {
        order.push('agent_end:start');
        await barrier.promise;
        order.push('agent_end:finish');
      }
      if (event.type === 'settled') {
        order.push('settled');
      }
    });

    const promptPromise = harness.prompt('hello');
    let idleResolved = false;
    const idlePromise = harness.waitForIdle().then(() => {
      idleResolved = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(idleResolved).toBe(false);
    expect(order).toEqual(['agent_end:start']);

    barrier.resolve();
    await Promise.all([promptPromise, idlePromise]);

    expect(idleResolved).toBe(true);
    expect(order).toEqual(['agent_end:start', 'agent_end:finish', 'settled']);
  });

  it('keeps assistant/toolResult persistence order when message_end subscribers yield', async () => {
    const session = new Session(new InMemorySessionStorage());
    const harness = makeHarness(session);
    const internals = harness as unknown as HarnessInternals;
    const responses = [makeToolUseAssistantMessage(), makeAssistantTextMessage('done', 20)];

    internals.createStreamFn = () => () => {
      const response = responses.shift();
      if (!response) throw new Error('No response queued');
      return makeAssistantStream(response);
    };
    harness.setTools([
      {
        name: 'echo',
        label: 'Echo',
        description: 'Echo text back',
        parameters: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
        execute: async (_toolCallId, input) => ({
          content: [{ type: 'text', text: `echo:${(input as { text: string }).text}` }],
          details: input,
        }),
      },
    ]);
    harness.subscribe(async (event) => {
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    });

    await harness.prompt('run tool');

    const entries = await session.getEntries();
    const roles = entries.flatMap((entry) =>
      entry.type === 'message' ? [entry.message.role] : [],
    );
    expect(roles).toEqual(['user', 'assistant', 'toolResult', 'assistant']);
  });

  it('includes pending appended messages in the next provider context', async () => {
    const session = new Session(new InMemorySessionStorage());
    const harness = makeHarness(session);
    const internals = harness as unknown as HarnessInternals;
    const responses = [makeToolUseAssistantMessage(), makeAssistantTextMessage('done', 20)];
    const capturedUserTexts: string[][] = [];

    internals.createStreamFn = () => (_model: unknown, context: Context) => {
      capturedUserTexts.push(textFromUserMessages(context.messages));
      const response = responses.shift();
      if (!response) throw new Error('No response queued');
      return makeAssistantStream(response);
    };
    await harness.setTools(
      [
        {
          name: 'echo',
          label: 'Echo',
          description: 'Echo text back',
          parameters: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
          },
          execute: async (_toolCallId, input) => ({
            content: [{ type: 'text', text: `echo:${(input as { text: string }).text}` }],
            details: input,
          }),
        },
      ],
      ['echo'],
    );
    harness.subscribe(async (event) => {
      if (event.type !== 'message_end' || event.message.role !== 'assistant') return;
      await harness.appendMessage(makeUserMessage('listener injected'));
    });

    await harness.prompt('run tool');

    expect(capturedUserTexts).toEqual([['run tool'], ['run tool', 'listener injected']]);
  });

  it('continue waits for the full tool loop when the continuation response uses tools', async () => {
    const session = new Session(new InMemorySessionStorage());
    await session.appendMessage(makeUserMessage('retry from here'));
    const harness = makeHarness(session);
    const internals = harness as unknown as HarnessInternals;
    const responses = [makeToolUseAssistantMessage(), makeAssistantTextMessage('final answer', 20)];
    let toolExecuted = false;

    internals.createStreamFn = () => () => {
      const response = responses.shift();
      if (!response) throw new Error('No response queued');
      return makeAssistantStream(response);
    };
    await harness.setTools(
      [
        {
          name: 'echo',
          label: 'Echo',
          description: 'Echo text back',
          parameters: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
          },
          execute: async (_toolCallId, input) => {
            toolExecuted = true;
            return {
              content: [{ type: 'text', text: `echo:${(input as { text: string }).text}` }],
              details: input,
            };
          },
        },
      ],
      ['echo'],
    );

    await harness.continue();

    expect(toolExecuted).toBe(true);
    const entries = await session.getEntries();
    const roles = entries.flatMap((entry) =>
      entry.type === 'message' ? [entry.message.role] : [],
    );
    expect(roles).toEqual(['user', 'assistant', 'toolResult', 'assistant']);
  });

  it('continues queued follow-up messages from an assistant tail', async () => {
    const session = new Session(new InMemorySessionStorage());
    await session.appendMessage(makeAssistantMessage());
    const harness = makeHarness(session);
    const internals = harness as unknown as HarnessInternals;
    const queuedMessage = makeUserMessage('queued follow-up');
    let receivedMessages: AgentMessage[] | undefined;

    internals.followUpQueue = [queuedMessage];
    internals.executePromptMessages = async (_turnState, messages) => {
      receivedMessages = messages;
      return makeAssistantMessage();
    };

    await harness.continue();

    expect(receivedMessages).toEqual([queuedMessage]);
    expect(internals.followUpQueue).toHaveLength(0);
  });
});

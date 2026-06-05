import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { Model } from '@scout-agent/ai';
import { AgentHarness } from '../../src/harness/agent-harness.ts';
import { NodeExecutionEnv } from '../../src/harness/env/nodejs.ts';
import { JsonlSessionStorage } from '../../src/harness/session/jsonl-storage.ts';
import { InMemorySessionStorage } from '../../src/harness/session/memory-storage.ts';
import { Session } from '../../src/harness/session/session.ts';
import type { ExecutionEnv } from '../../src/harness/types.ts';
import type { AgentEvent, AgentMessage } from '../../src/types.ts';
import { createTempDir } from './session-test-utils.ts';

type HarnessWithEventHandler = AgentHarness & {
  handleAgentEvent(event: AgentEvent): Promise<void>;
};

type HarnessInternals = {
  followUpQueue: AgentMessage[];
  nextTurnQueue: AgentMessage[];
  executePromptMessages(
    turnState: unknown,
    messages: AgentMessage[],
    options: { skipInitialSteeringPoll?: boolean; missingAssistantLabel: string },
  ): Promise<AgentMessage>;
};

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

function makeUserMessage(text: string): AgentMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp: 2,
  };
}

function makeHarness(session: Session): AgentHarness {
  return new AgentHarness({
    env: {} as unknown as ExecutionEnv,
    session,
    model: makeModel(),
    systemPrompt: 'test',
  });
}

function subscribeReplacement(harness: AgentHarness): void {
  harness.subscribe((event) => {
    if (event.type !== 'message_end') return;
    const mutableMessage = event.message as unknown as Record<string, unknown>;
    mutableMessage.content = [{ type: 'text', text: 'replacement' }];
    mutableMessage.timestamp = 2;
  });
}

async function handleMessageEnd(harness: AgentHarness, message: AgentMessage): Promise<void> {
  await (harness as unknown as HarnessWithEventHandler).handleAgentEvent({
    type: 'message_end',
    message,
  });
}

describe('AgentHarness lifecycle', () => {
  it('persists message_end subscriber replacements', async () => {
    const session = new Session(new InMemorySessionStorage({ cwd: '/test' }));
    const harness = makeHarness(session);
    const message = makeAssistantMessage();

    subscribeReplacement(harness);
    await handleMessageEnd(harness, message);

    const context = await session.buildContext();
    expect(context.messages).toHaveLength(1);
    expect(context.messages[0]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'replacement' }],
      timestamp: 2,
    });
  });

  it('persists message_end subscriber replacements to JSONL reloads', async () => {
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

    subscribeReplacement(harness);
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

  it('continues queued follow-up messages from an assistant tail', async () => {
    const session = new Session(new InMemorySessionStorage({ cwd: '/test' }));
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

  it('does not treat next-turn messages as pending continuation work', async () => {
    const session = new Session(new InMemorySessionStorage({ cwd: '/test' }));
    const harness = makeHarness(session);
    const internals = harness as unknown as HarnessInternals;

    await harness.nextTurn('next prompt context');

    expect(internals.nextTurnQueue).toHaveLength(1);
    expect(harness.hasPendingMessages()).toBe(false);
  });
});

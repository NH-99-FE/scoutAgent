import { describe, expect, it } from 'vitest';
import { AgentHarness } from '../../src/harness/agent-harness.ts';
import { InMemorySessionStorage } from '../../src/harness/session/memory-storage.ts';
import { Session } from '../../src/harness/session/session.ts';
import type { AgentMessage } from '../../src/types.ts';

describe('AgentHarness lifecycle', () => {
  it('persists message_end subscriber replacements', async () => {
    const session = new Session(new InMemorySessionStorage({ cwd: '/test' }));
    const harness = new AgentHarness({
      env: {} as any,
      session,
      model: { id: 'test-model', provider: 'test', input: ['text'] } as any,
      systemPrompt: 'test',
    });
    const message: AgentMessage = {
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

    harness.subscribe((event) => {
      if (event.type !== 'message_end') return;
      const mutableMessage = event.message as unknown as Record<string, unknown>;
      mutableMessage.content = [{ type: 'text', text: 'replacement' }];
      mutableMessage.timestamp = 2;
    });

    await (harness as any).handleAgentEvent({ type: 'message_end', message });

    const context = await session.buildContext();
    expect(context.messages).toHaveLength(1);
    expect(context.messages[0]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'replacement' }],
      timestamp: 2,
    });
  });
});

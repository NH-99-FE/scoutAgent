import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AgentTool } from '@scout-agent/agent';
import { Type } from '@sinclair/typebox';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSession } from '../../src/core/agent-session.ts';
import type { ScoutExtensionRunner } from '../../src/core/extensions/index.ts';
import {
  MutationJournal,
  runDiffWorkerRequest,
  type DiffWorkerClientPort,
  type DiffWorkerRequest,
  type DiffWorkerResponseListener,
} from '../../src/core/review/index.ts';
import { createSyntheticSourceInfo } from '../../src/core/source-info.ts';
import { SessionManager } from '../../src/core/session/index.ts';
import type { ToolDefinition } from '../../src/core/tools/index.ts';
import { createConfigManager } from './test-utils.ts';

interface ToolRegistryEntryForTest {
  definition: ToolDefinition;
  tool: AgentTool;
  sourceType: 'builtin' | 'extension';
}

interface AgentSessionInternals {
  rebuildToolRegistry(): void;
  toolRegistry: Map<string, ToolRegistryEntryForTest>;
}

const tempDirs: string[] = [];

class InlineDiffWorkerClient implements DiffWorkerClientPort {
  request(request: DiffWorkerRequest, listener: DiffWorkerResponseListener): void {
    listener(runDiffWorkerRequest(request));
  }

  dispose(): void {}
}

function makeTempDir(): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-agent-session-mutation-'));
  tempDirs.push(cwd);
  return cwd;
}

function makeSession(cwd: string, extensionRunner?: ScoutExtensionRunner): AgentSession {
  return new AgentSession({
    session: SessionManager.inMemory(cwd),
    configManager: createConfigManager(cwd),
    cwd,
    logger: { appendLine: vi.fn() },
    skills: [],
    extensionRunner,
    mutationJournal: new MutationJournal({
      diffWorkerClient: new InlineDiffWorkerClient(),
    }),
  });
}

function getInternals(session: AgentSession): AgentSessionInternals {
  return session as unknown as AgentSessionInternals;
}

afterEach(() => {
  for (const cwd of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

describe('AgentSession mutation capture assembly', () => {
  it('assigns a unique capture owner to each runtime', () => {
    const first = makeSession(makeTempDir());
    const second = makeSession(makeTempDir());

    expect(first.getMutationCaptureOwnerId()).not.toBe(second.getMutationCaptureOwnerId());

    first.dispose();
    second.dispose();
  });

  it('captures the builtin edit definition and returns Pi-style details', async () => {
    const cwd = makeTempDir();
    const target = path.join(cwd, 'sample.txt');
    fs.writeFileSync(target, 'before\n', 'utf8');
    const session = makeSession(cwd);
    const internals = getInternals(session);
    internals.rebuildToolRegistry();
    const edit = internals.toolRegistry.get('edit');

    expect(edit?.sourceType).toBe('builtin');
    const result = await edit!.tool.execute('builtin-edit', {
      path: 'sample.txt',
      edits: [{ oldText: 'before', newText: 'after' }],
    });

    // edit 工具保持 Pi-style details，Review 事实通过旁路 Journal 记录。
    expect(result.details).toMatchObject({
      diff: expect.any(String),
      patch: expect.any(String),
      firstChangedLine: expect.any(Number),
    });
    const records = session.getMutationJournal().getRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      ownerId: session.getMutationCaptureOwnerId(),
      toolCallId: 'builtin-edit',
      operation: 'edit',
      path: 'sample.txt',
      toolOutcome: 'success',
    });
    expect(records[0].before.content).toBe('before\n');
    expect(records[0].after.content).toBe('after\n');
    expect(fs.readFileSync(target, 'utf8')).toBe('after\n');

    session.dispose();
  });

  it('captures builtin write with a null baseline for new files', async () => {
    const cwd = makeTempDir();
    const target = path.join(cwd, 'write.txt');
    const after = 'after write\n';
    const session = makeSession(cwd);
    const internals = getInternals(session);
    internals.rebuildToolRegistry();
    const write = internals.toolRegistry.get('write');

    const result = await write!.tool.execute('builtin-write', {
      path: 'write.txt',
      content: after,
    });

    // 阶段 4：write 工具返回 details: undefined，capture 由 Journal 处理
    expect(result.details).toBeUndefined();
    const [record] = session.getMutationJournal().getRecords();
    expect(record.before.content).toBeNull();
    expect(record.after.content).toBe(after);
    expect(record.toolOutcome).toBe('success');
    expect(fs.readFileSync(target, 'utf8')).toBe(after);

    session.dispose();
  });

  it('does not capture an extension definition that overrides builtin edit by name', async () => {
    const cwd = makeTempDir();
    const target = path.join(cwd, 'extension.txt');
    const extensionSchema = Type.Object({ path: Type.String(), content: Type.String() });
    const extensionDefinition: ToolDefinition<typeof extensionSchema> = {
      name: 'edit',
      label: 'extension edit',
      description: 'Extension override',
      parameters: extensionSchema,
      async execute(_toolCallId, input) {
        fs.writeFileSync(path.resolve(cwd, input.path), input.content, 'utf8');
        return {
          content: [{ type: 'text', text: 'extension wrote file' }],
          details: undefined,
        };
      },
    };
    const extensionRunner = {
      getAllRegisteredTools: () => [
        {
          definition: extensionDefinition,
          sourceInfo: createSyntheticSourceInfo('<extension:edit>', { source: 'extension' }),
        },
      ],
      createContext: () => undefined,
      invalidate: () => undefined,
    } as unknown as ScoutExtensionRunner;
    const session = makeSession(cwd, extensionRunner);
    const internals = getInternals(session);
    internals.rebuildToolRegistry();
    const edit = internals.toolRegistry.get('edit');

    expect(edit?.sourceType).toBe('extension');
    await edit!.tool.execute('extension-edit', {
      path: 'extension.txt',
      content: 'written outside builtin capture',
    });

    expect(fs.readFileSync(target, 'utf8')).toBe('written outside builtin capture');
    expect(session.getMutationJournal().getRecords()).toHaveLength(0);

    session.dispose();
  });
});

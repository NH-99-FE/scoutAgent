import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
} from '../../src/core/agent-session-services.ts';
import { ScoutResourceLoader } from '../../src/core/resource-loader.ts';
import { SessionManager as CoreSessionManager } from '../../src/core/session/index.ts';
import { createConfigManager } from './test-utils.ts';
import {
  createExtensionRuntime,
  loadExtensionFromFactory,
  ScoutExtensionRunner,
} from '../../src/core/extensions/index.ts';

describe('createAgentSessionServices', () => {
  let tempDir: string;
  let cwd: string;
  let agentDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-services-test-'));
    cwd = path.join(tempDir, 'project');
    agentDir = path.join(tempDir, 'agent');
    fs.mkdirSync(path.join(cwd, '.scout', 'extensions'), { recursive: true });
    fs.mkdirSync(path.join(agentDir, 'skills', 'service-skill'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads cwd-bound resources and extension runner diagnostics as services', async () => {
    fs.writeFileSync(
      path.join(agentDir, 'skills', 'service-skill', 'SKILL.md'),
      `---\nname: service-skill\ndescription: Service skill\n---\nBody`,
    );
    fs.writeFileSync(
      path.join(cwd, '.scout', 'extensions', 'command.ts'),
      `export default function(scout) {
        scout.registerCommand("service", { description: "service command", handler: async () => {} });
      }`,
    );
    fs.writeFileSync(
      path.join(cwd, '.scout', 'extensions', 'broken.ts'),
      `export default function() { throw new Error("broken extension"); }`,
    );

    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      configManager: createConfigManager(cwd),
      session: CoreSessionManager.inMemory(cwd),
    });

    expect(services.cwd).toBe(cwd);
    expect(services.resources.skills.map((skill) => skill.name)).toEqual(['service-skill']);
    expect(
      services.extensionRunner?.getRegisteredCommands().map((command) => command.name),
    ).toEqual(['service']);
    expect(services.diagnostics.some((diag) => diag.message.includes('broken extension'))).toBe(
      true,
    );
  });

  it('creates an empty extension runner so replacement contexts work without extensions', async () => {
    const session = CoreSessionManager.inMemory(cwd);
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      configManager: createConfigManager(cwd),
      session,
    });

    expect(services.extensionRunner.getRegisteredCommands()).toEqual([]);
    await expect(
      services.extensionRunner.emitToolCall({
        type: 'tool_call',
        toolCallId: 'call-1',
        toolName: 'bash',
        input: { command: 'sudo echo ok' },
      }),
    ).resolves.toBeUndefined();

    const result = await createAgentSessionFromServices({
      services,
      session,
      logger: { appendLine: () => undefined },
      sessionStartEvent: { type: 'session_start', reason: 'new' },
    });

    await result.session.bindExtensions();
    expect(result.session.createReplacedSessionContext().startUserMessage).toEqual(
      expect.any(Function),
    );
    result.session.dispose();
  });

  it('threads loaded system prompt resources into AgentSession', async () => {
    fs.mkdirSync(path.join(cwd, '.scout'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.scout', 'SYSTEM.md'), 'project system');
    fs.writeFileSync(path.join(cwd, '.scout', 'APPEND_SYSTEM.md'), 'project append');
    const session = CoreSessionManager.inMemory(cwd);
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      configManager: createConfigManager(cwd),
      session,
    });

    const result = await createAgentSessionFromServices({
      services,
      session,
      logger: { appendLine: () => undefined },
      sessionStartEvent: { type: 'session_start', reason: 'new' },
    });
    const prompt = (
      result.session as unknown as { buildCurrentSystemPrompt: () => string }
    ).buildCurrentSystemPrompt();

    expect(prompt).toContain('project system');
    expect(prompt).toContain('project append');
    result.session.dispose();
  });

  it('keeps extension tools active but omits them from prompt without promptSnippet', async () => {
    fs.writeFileSync(
      path.join(cwd, '.scout', 'extensions', 'hidden-tool.ts'),
      `export default function(scout) {
        void scout.registerTool({
          name: "hidden_tool",
          label: "Hidden Tool",
          description: "Description should not appear in available tools",
          parameters: { type: "object", properties: {}, additionalProperties: false },
          execute: async () => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
        });
      }`,
    );
    const session = CoreSessionManager.inMemory(cwd);
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      configManager: createConfigManager(cwd),
      session,
    });

    const result = await createAgentSessionFromServices({
      services,
      session,
      logger: { appendLine: () => undefined },
      sessionStartEvent: { type: 'session_start', reason: 'new' },
    });
    const prompt = (
      result.session as unknown as { buildCurrentSystemPrompt: () => string }
    ).buildCurrentSystemPrompt();

    expect(result.session.getAllToolInfos().map((tool) => tool.name)).toContain('hidden_tool');
    expect(result.session.getActiveToolNames()).toContain('hidden_tool');
    expect(prompt).not.toContain('hidden_tool');
    expect(prompt).not.toContain('Description should not appear in available tools');
    result.session.dispose();
  });

  it('does not emit session lifecycle during session creation', async () => {
    const discoveredSkillDir = path.join(tempDir, 'discovered-skill');
    fs.mkdirSync(discoveredSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(discoveredSkillDir, 'SKILL.md'),
      `---\nname: discovered\ndescription: Discovered skill\n---\nBody`,
    );
    const events: unknown[] = [];
    const runtime = createExtensionRuntime();
    const extension = await loadExtensionFromFactory(
      async (scout) => {
        scout.on('session_start', async (event) => {
          events.push(event);
        });
        scout.on('resources_discover', async (event) => {
          events.push(event);
          return { skillPaths: [discoveredSkillDir] };
        });
      },
      runtime,
      undefined,
      '<lifecycle>',
    );
    const session = CoreSessionManager.inMemory(cwd);
    const configManager = createConfigManager(cwd);
    const extensionRunner = new ScoutExtensionRunner(
      [extension],
      runtime,
      cwd,
      session,
      configManager,
    );
    const resourceLoader = new ScoutResourceLoader({ cwd, agentDir });
    const resources = await resourceLoader.load();

    const result = await createAgentSessionFromServices({
      services: {
        cwd,
        agentDir,
        configManager,
        resourceLoader,
        resources,
        extensionRunner,
        diagnostics: [],
      },
      session,
      logger: { appendLine: () => undefined },
      sessionStartEvent: { type: 'session_start', reason: 'resume' },
    });

    expect(events).toEqual([]);
    expect(result.session.getCommands().map((command) => command.name)).not.toContain(
      'skill:discovered',
    );
    await result.session.bindExtensions();
    expect(events).toEqual([
      { type: 'session_start', reason: 'resume' },
      { type: 'resources_discover', cwd, reason: 'startup' },
    ]);
    expect(result.session.getCommands().map((command) => command.name)).toContain(
      'skill:discovered',
    );
    result.session.dispose();
  });
});

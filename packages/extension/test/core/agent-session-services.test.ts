import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { ScoutPackageManager } from '../../src/core/package-manager.ts';

function writePrompt(filePath: string, description: string, body = 'Prompt body'): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `---\ndescription: ${description}\n---\n${body}`);
}

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

  it('loads extensions contributed by package resource settings', async () => {
    const packageDir = path.join(tempDir, 'extension-package');
    fs.mkdirSync(path.join(packageDir, 'extensions'), { recursive: true });
    fs.writeFileSync(
      path.join(packageDir, 'extensions', 'package-command.ts'),
      `export default function(scout) {
        scout.registerCommand("package-command", { description: "package command", handler: async () => {} });
      }`,
    );
    fs.writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({ scout: { extensions: ['extensions/*.ts'] } }),
    );

    const configManager = createConfigManager(cwd);
    configManager.saveRuntimeSettings('project', {
      operations: [{ op: 'set', path: 'packages', value: [packageDir] }],
    });

    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      configManager,
      session: CoreSessionManager.inMemory(cwd),
    });

    expect(services.extensionRunner.getRegisteredCommands().map((command) => command.name)).toEqual(
      ['package-command'],
    );
  });

  it('resolves package resources once while assembling services', async () => {
    const packageDir = path.join(tempDir, 'single-resolve-package');
    fs.mkdirSync(path.join(packageDir, 'extensions'), { recursive: true });
    fs.mkdirSync(path.join(packageDir, 'skills', 'package-skill'), { recursive: true });
    writePrompt(path.join(packageDir, 'prompts', 'package-prompt.md'), 'Package prompt');
    fs.writeFileSync(
      path.join(packageDir, 'extensions', 'package-command.ts'),
      `export default function(scout) {
        scout.registerCommand("package-command", { description: "package command", handler: async () => {} });
      }`,
    );
    fs.writeFileSync(
      path.join(packageDir, 'skills', 'package-skill', 'SKILL.md'),
      `---\nname: package-skill\ndescription: Package skill\n---\nBody`,
    );
    fs.writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({
        scout: {
          extensions: ['extensions/*.ts'],
          skills: ['skills/*'],
          prompts: ['prompts/*.md'],
        },
      }),
    );
    const configManager = createConfigManager(cwd);
    configManager.saveRuntimeSettings('project', {
      operations: [{ op: 'set', path: 'packages', value: [packageDir] }],
    });
    const resolveSpy = vi.spyOn(ScoutPackageManager.prototype, 'resolve');

    try {
      const services = await createAgentSessionServices({
        cwd,
        agentDir,
        configManager,
        session: CoreSessionManager.inMemory(cwd),
      });

      expect(resolveSpy).toHaveBeenCalledTimes(1);
      expect(
        services.extensionRunner.getRegisteredCommands().map((command) => command.name),
      ).toEqual(['package-command']);
      expect(services.resources.skills.map((skill) => skill.name)).toContain('package-skill');
      expect(services.resources.promptTemplates.map((prompt) => prompt.name)).toContain(
        'package-prompt',
      );
    } finally {
      resolveSpy.mockRestore();
    }
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

  it('expands skill commands by reading the current skill file', async () => {
    const skillPath = path.join(agentDir, 'skills', 'service-skill', 'SKILL.md');
    fs.writeFileSync(
      skillPath,
      `---\nname: service-skill\ndescription: Service skill\n---\nInitial body`,
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

    fs.writeFileSync(
      skillPath,
      `---\nname: service-skill\ndescription: Service skill\n---\nUpdated body`,
    );
    const expanded = (
      result.session as unknown as { expandPromptCommands: (text: string) => string }
    ).expandPromptCommands('/skill:service-skill\nship\tit');

    expect(expanded).toContain(`<skill name="service-skill" location="${skillPath}">`);
    expect(expanded).toContain('Updated body');
    expect(expanded).not.toContain('Initial body');
    expect(expanded).toContain('\n\nship\tit');
    result.session.dispose();
  });

  it('expands prompt template commands with Pi-style argument parsing', async () => {
    writePrompt(
      path.join(agentDir, 'prompts', 'review.md'),
      'Review prompt',
      'Review $1 with ${@:2}\nAll: $ARGUMENTS',
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

    const expanded = (
      result.session as unknown as { expandPromptCommands: (text: string) => string }
    ).expandPromptCommands('/review "first file" second\nthird');

    expect(expanded).toBe('Review first file with second third\nAll: first file second third');
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

    await result.session.setToolProfile('review');
    expect(result.session.getActiveToolNames()).not.toContain('hidden_tool');

    await result.session.setToolProfile('develop');
    expect(result.session.getActiveToolNames()).toContain('hidden_tool');
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

  it('replaces extension-discovered resources when a later discover returns empty', async () => {
    const discoveredSkillDir = path.join(tempDir, 'discovered-skill');
    fs.mkdirSync(discoveredSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(discoveredSkillDir, 'SKILL.md'),
      `---\nname: discovered\ndescription: Discovered skill\n---\nBody`,
    );
    let exposeSkill = true;
    const events: unknown[] = [];
    const runtime = createExtensionRuntime();
    const extension = await loadExtensionFromFactory(
      async (scout) => {
        scout.on('resources_discover', async (event) => {
          events.push(event);
          return exposeSkill ? { skillPaths: [discoveredSkillDir] } : { skillPaths: [] };
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

    await result.session.bindExtensions();
    expect(result.session.getCommands().map((command) => command.name)).toContain(
      'skill:discovered',
    );

    exposeSkill = false;
    await result.session.discoverExtensionResources('reload');

    expect(result.session.getCommands().map((command) => command.name)).not.toContain(
      'skill:discovered',
    );
    expect(events).toEqual([
      { type: 'resources_discover', cwd, reason: 'startup' },
      { type: 'resources_discover', cwd, reason: 'reload' },
    ]);
    result.session.dispose();
  });

  it('replaces extension-discovered prompt commands when a later discover returns empty', async () => {
    const discoveredPromptDir = path.join(tempDir, 'discovered-prompts');
    writePrompt(path.join(discoveredPromptDir, 'discovered.md'), 'Discovered prompt');
    let exposePrompt = true;
    const events: unknown[] = [];
    const runtime = createExtensionRuntime();
    const extension = await loadExtensionFromFactory(
      async (scout) => {
        scout.on('resources_discover', async (event) => {
          events.push(event);
          return exposePrompt ? { promptPaths: [discoveredPromptDir] } : { promptPaths: [] };
        });
      },
      runtime,
      undefined,
      '<prompt-lifecycle>',
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

    await result.session.bindExtensions();
    expect(result.session.getCommands().map((command) => command.name)).toContain('discovered');

    exposePrompt = false;
    await result.session.discoverExtensionResources('reload');

    expect(result.session.getCommands().map((command) => command.name)).not.toContain('discovered');
    expect(events).toEqual([
      { type: 'resources_discover', cwd, reason: 'startup' },
      { type: 'resources_discover', cwd, reason: 'reload' },
    ]);
    result.session.dispose();
  });

  it('clears extension-discovered resources when the replacement runner has no discover handlers', async () => {
    const discoveredSkillDir = path.join(tempDir, 'stale-skill');
    fs.mkdirSync(discoveredSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(discoveredSkillDir, 'SKILL.md'),
      `---\nname: stale-skill\ndescription: Stale skill\n---\nBody`,
    );
    const runtime = createExtensionRuntime();
    const extension = await loadExtensionFromFactory(
      async (scout) => {
        scout.on('resources_discover', async () => ({ skillPaths: [discoveredSkillDir] }));
      },
      runtime,
      undefined,
      '<stale>',
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

    await result.session.bindExtensions();
    expect(result.session.getCommands().map((command) => command.name)).toContain(
      'skill:stale-skill',
    );

    const emptyRunner = new ScoutExtensionRunner(
      [],
      createExtensionRuntime(),
      cwd,
      session,
      configManager,
    );
    result.session.setExtensionRunner(emptyRunner);
    await result.session.discoverExtensionResources('reload');

    expect(result.session.getCommands().map((command) => command.name)).not.toContain(
      'skill:stale-skill',
    );
    result.session.dispose();
  });
});

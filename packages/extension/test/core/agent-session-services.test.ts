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

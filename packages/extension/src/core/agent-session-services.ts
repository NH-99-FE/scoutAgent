// ============================================================
// AgentSessionServices — Pi-style cwd-bound service assembly
// 负责：构造 cwd 绑定的资源加载器、扩展 runner，并从 services 创建 AgentSession。
// ============================================================

import type { ScoutCoreConfig } from './config.ts';
import { AgentSession } from './agent-session.ts';
import {
  ScoutExtensionRunner,
  discoverAndLoadExtensions,
  type SessionStartEvent,
} from './extensions/index.ts';
import { ScoutResourceLoader, type LoadedScoutResources } from './resource-loader.ts';
import type {
  AgentSessionRuntimeDiagnostic,
  CreateAgentSessionRuntimeResult,
} from './agent-session-runtime.ts';
import type { Session } from './session/index.ts';
import type { CoreLogger } from './logger.ts';
import type { Api, Model } from '@scout-agent/ai';
import type { ThinkingLevel } from '@scout-agent/agent';
import type { FileReviewTurnSnapshot } from './review/file-review.ts';

// ---------- 类型 ----------

export interface AgentSessionServices {
  cwd: string;
  agentDir: string;
  configManager: ScoutCoreConfig;
  resourceLoader: ScoutResourceLoader;
  resources: LoadedScoutResources;
  extensionRunner: ScoutExtensionRunner;
  diagnostics: AgentSessionRuntimeDiagnostic[];
}

export interface CreateAgentSessionServicesOptions {
  cwd: string;
  agentDir: string;
  configManager: ScoutCoreConfig;
  session: Session;
}

export interface CreateAgentSessionFromServicesOptions {
  services: AgentSessionServices;
  session: Session;
  logger: CoreLogger;
  activeToolNames?: string[];
  includeAllExtensionTools?: boolean;
  initialModel?: Model<Api>;
  initialThinkingLevel?: ThinkingLevel;
  sessionStartEvent?: SessionStartEvent;
  onFileReviewUpdated?: (session: AgentSession, review: FileReviewTurnSnapshot) => void;
}

// ---------- Services ----------

export async function createAgentSessionServices(
  options: CreateAgentSessionServicesOptions,
): Promise<AgentSessionServices> {
  const diagnostics: AgentSessionRuntimeDiagnostic[] = [];
  const configuredPaths = options.configManager.getExtensionPaths();
  const extensionResult = await discoverAndLoadExtensions(
    configuredPaths,
    options.cwd,
    options.agentDir,
  );

  for (const error of extensionResult.errors) {
    diagnostics.push({
      type: 'error',
      message: `Extension "${error.path}" error: ${error.error}`,
    });
  }

  const extensionRunner = new ScoutExtensionRunner(
    extensionResult.extensions,
    extensionResult.runtime,
    options.cwd,
    options.session,
    options.configManager,
  );

  const resourceLoader = new ScoutResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDir,
  });
  const resources = await resourceLoader.load();
  diagnostics.push(...resources.diagnostics);

  return {
    cwd: options.cwd,
    agentDir: options.agentDir,
    configManager: options.configManager,
    resourceLoader,
    resources,
    extensionRunner,
    diagnostics,
  };
}

export async function createAgentSessionFromServices(
  options: CreateAgentSessionFromServicesOptions,
): Promise<CreateAgentSessionRuntimeResult> {
  const diagnostics: AgentSessionRuntimeDiagnostic[] = [...options.services.diagnostics];
  let modelFallbackMessage: string | undefined;
  const context = await options.session.buildContext();

  if (context.model) {
    const savedModelRef = `${context.model.provider}/${context.model.modelId}`;
    const restoredModel = options.services.configManager.findModelByProvider(
      context.model.provider,
      context.model.modelId,
    );
    const restoredModelAvailable =
      restoredModel && options.services.configManager.hasConfiguredModelAuth(restoredModel);
    if (!restoredModelAvailable) {
      const fallbackModel = options.services.configManager.findDefaultModel();
      if (fallbackModel) {
        modelFallbackMessage = `Session model "${savedModelRef}" is unavailable. Falling back to "${fallbackModel.provider}/${fallbackModel.id}".`;
        diagnostics.push({ type: 'warning', message: modelFallbackMessage });
      }
    }
  }

  const agentSession = new AgentSession({
    session: options.session,
    configManager: options.services.configManager,
    cwd: options.services.cwd,
    logger: options.logger,
    skills: options.services.resources.skills,
    promptTemplates: options.services.resources.promptTemplates,
    contextFiles: options.services.resources.contextFiles,
    systemPrompt: options.services.resources.systemPrompt,
    appendSystemPrompt: options.services.resources.appendSystemPrompt,
    extensionRunner: options.services.extensionRunner,
    loadExtensionResources: (resources) =>
      options.services.resourceLoader.extendResources(resources),
    activeToolNames: options.activeToolNames,
    includeAllExtensionTools: options.includeAllExtensionTools,
    initialModel: options.initialModel,
    initialThinkingLevel: options.initialThinkingLevel,
    sessionStartEvent: options.sessionStartEvent,
    onFileReviewUpdated: options.onFileReviewUpdated,
  });

  try {
    await agentSession.initialize();
  } catch (error) {
    agentSession.dispose();
    throw error;
  }

  return {
    session: agentSession,
    diagnostics,
    modelFallbackMessage,
  };
}

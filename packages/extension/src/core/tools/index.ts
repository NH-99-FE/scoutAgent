// ============================================================
// tools — barrel file
// ============================================================

export {
  createReadTool,
  createReadToolDefinition,
  type ReadToolInput,
  type ReadToolDetails,
  type ReadToolOptions,
  type ReadOperations,
} from './read.ts';
export {
  createBashTool,
  createBashToolDefinition,
  type BashToolInput,
  type BashToolDetails,
  type BashToolOptions,
  type BashOperations,
  type BashSpawnContext,
  type BashSpawnHook,
  createLocalBashOperations,
} from './bash.ts';
export {
  createEditTool,
  createEditToolDefinition,
  type EditToolInput,
  type EditToolDetails,
  type EditToolOptions,
  type EditOperations,
} from './edit.ts';
export {
  createWriteTool,
  createWriteToolDefinition,
  type WriteToolInput,
  type WriteToolDetails,
  type WriteToolOptions,
  type WriteOperations,
} from './write.ts';
export {
  createGrepTool,
  createGrepToolDefinition,
  type GrepToolInput,
  type GrepToolDetails,
  type GrepToolOptions,
  type GrepOperations,
} from './grep.ts';
export {
  createFindTool,
  createFindToolDefinition,
  type FindToolInput,
  type FindToolDetails,
  type FindToolOptions,
  type FindOperations,
} from './find.ts';
export {
  createLsTool,
  createLsToolDefinition,
  type LsToolInput,
  type LsToolDetails,
  type LsToolOptions,
  type LsOperations,
} from './ls.ts';
export {
  createTool,
  createToolDefinition,
  createTools,
  createDefaultTools,
  createAllToolDefinitions,
  createBuiltinToolDefinitionEntries,
  BUILTIN_TOOL_DEFINITION_ENTRIES,
  DEFAULT_ACTIVE_TOOL_NAMES,
  ALL_TOOL_NAMES,
  type ToolName,
  type ToolDef,
  type ToolDefinitionEntry,
  type ToolsOptions,
} from './create-tools.ts';
export {
  wrapToolDefinition,
  wrapToolDefinitions,
  createToolDefinitionFromAgentTool,
} from './tool-definition-wrapper.ts';
export type {
  ToolDefinition,
  ToolRenderComponent,
  ToolRenderContext,
  ToolRenderResultOptions,
  ToolRenderTheme,
} from '../extensions/types.ts';
export { withFileMutationQueue } from './shared/file-mutation-queue.ts';
export {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  type TruncationResult,
  truncateHead,
  truncateTail,
  truncateLine,
} from './shared/truncate.ts';
export { resolveToCwd, resolveReadPathAsync, pathExists } from './shared/path-utils.ts';
export {
  OutputAccumulator,
  type OutputAccumulatorOptions,
  type OutputSnapshot,
} from './shared/output-accumulator.ts';
export {
  applyEditsToNormalizedContent,
  computeEditsDiff,
  detectLineEnding,
  generateDiffString,
  generateUnifiedPatch,
  normalizeToLF,
  restoreLineEndings,
  stripBom,
  type Edit,
  type EditDiffResult,
  type EditDiffError,
  type AppliedEditsResult,
  type FuzzyMatchResult,
} from './shared/edit-diff.ts';
export {
  killProcessTree,
  killTrackedDetachedChildren,
  trackDetachedChildPid,
  untrackDetachedChildPid,
  waitForChildProcess,
} from './shared/process-utils.ts';
export { getShellConfig, getShellEnv, type ShellConfig } from './shared/shell-config.ts';
export {
  detectSupportedImageMimeType,
  detectSupportedImageMimeTypeFromFile,
} from './shared/mime.ts';
export { ensureTool, getToolPath } from './shared/tools-manager.ts';

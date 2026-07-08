// ============================================================
// Shared 协议统一出口：Extension 与 Webview 消息
// ============================================================

export { WEBVIEW_TO_EXTENSION_MESSAGE_TYPES, SCOUT_PROTOCOL } from './protocol-requests.ts';
export type {
  ScoutControlMessage,
  ScoutProtocolCancel,
  ScoutProtocolKind,
  ScoutProtocolPayloadType,
  ScoutProtocolRequest,
  ScoutProtocolRoute,
  ScoutProtocolService,
  WebviewMessage,
  WebviewRequestPayload,
} from './protocol-requests.ts';

export type {
  ScoutCommandInfo,
  ScoutCommandSource,
  ScoutDiagnostic,
  ScoutDiagnosticType,
  ScoutFileMentionItem,
  ScoutFileMentionKind,
  ScoutSessionListItem,
  ScoutSessionTreeNode,
  ScoutSessionTreeNodeKind,
  ScoutSessionTreeToolArgument,
  ScoutSessionTreeToolCall,
  ScoutTaskHistoryPurpose,
  ScoutTaskItem,
  ScoutWebviewSurface,
  SourceInfo,
  SourceOrigin,
  SourceScope,
  ToolInfo,
  ToolPresentationMetadata,
} from './protocol-core.ts';

export type {
  ScoutChangesReviewFile,
  ScoutChangesReviewHostMessage,
  ScoutChangesReviewModel,
  ScoutChangesReviewRow,
  ScoutChangesReviewSummary,
  ScoutChangesReviewSummaryFile,
  ScoutChangesReviewToken,
  ScoutChangesReviewTokenDiff,
  ScoutChangesReviewViewMode,
  ScoutChangesReviewWebviewMessage,
} from './protocol-review.ts';

export type {
  ScoutExtensionListItem,
  ScoutExtensionsSettings,
  ScoutExtensionResourceScope,
  ScoutExtensionScope,
  ScoutExtensionTemplateInfo,
  ScoutExtensionTemplateId,
} from './protocol-extensions.ts';

export type {
  ScoutAssistantMessage,
  ScoutBranchSummaryMessage,
  ScoutBusyKind,
  ScoutBusyState,
  ScoutCompactionSummaryMessage,
  ScoutConfig,
  ScoutContent,
  ScoutContextUsage,
  ScoutCustomMessage,
  ScoutFileChangeDiffPreview,
  ScoutFileChangeDetails,
  ScoutFileChangeReviewRef,
  ScoutFileEditPreview,
  ScoutImageContent,
  ScoutMessage,
  ScoutQueuedFollowUp,
  ScoutQueuedMessage,
  ScoutQueuedMessageDelivery,
  ScoutQueueState,
  ScoutSessionStats,
  ScoutTextContent,
  ScoutThinkingContent,
  ScoutToolCallContent,
  ScoutToolCallPreview,
  ScoutToolCallPreviewUpdateEvent,
  ScoutToolExecutionResult,
  ScoutToolResultMessage,
  ScoutUserMessage,
  ScoutWebviewState,
} from './protocol-state.ts';

export type {
  ScoutBootstrapResult,
  ScoutCommandResult,
  ScoutCommandsResult,
  ScoutConfigResult,
  ScoutContextUsageResult,
  ScoutCustomModelsResult,
  ScoutExtensionsResult,
  ScoutFileMentionsResult,
  ScoutForkCandidate,
  ScoutForkCandidatesResult,
  ScoutForkResult,
  ScoutGenericCommandResult,
  ScoutGenericCommandResultType,
  ScoutProtocolResponsePayload,
  ScoutProtocolResponsePayloadType,
  ScoutRuntimeSettingsResult,
  ScoutSaveCustomModelsResult,
  ScoutSaveRuntimeSettingsResult,
  ScoutSessionsResult,
  ScoutStateResult,
  ScoutTaskHistoryResult,
  ScoutTreeResult,
} from './protocol-results.ts';

export { EXTENSION_TO_WEBVIEW_MESSAGE_TYPES } from './protocol-events.ts';
export type {
  ScoutExtensionUIRequest,
  ScoutExtensionUIRequestClosedEvent,
  ScoutExtensionUIRequestClosedReason,
} from './protocol-extension-ui.ts';

export type {
  ExtensionEventMessage,
  ExtensionMessage,
  ScoutAgentEvent,
  ScoutAutoRetryEndEvent,
  ScoutAutoRetryStartEvent,
  ScoutCompactionEndEvent,
  ScoutCompactionReason,
  ScoutCompactionResult,
  ScoutCompactionStartEvent,
  ScoutChangesReviewUpdateEvent,
  ScoutDomainEventType,
  ScoutNotificationMessage,
  ScoutProtocolError,
  ScoutProtocolResponse,
  ScoutRuntimeEvent,
  ScoutRuntimeExtensionEvent,
  ScoutRuntimeStateUpdateEvent,
} from './protocol-events.ts';

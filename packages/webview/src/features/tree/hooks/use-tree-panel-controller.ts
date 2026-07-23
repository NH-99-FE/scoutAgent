// ============================================================
// Tree Panel Controller — 会话树面板状态与协议动作
// ============================================================

import { useCallback, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { protocolClient } from '@/bridge/protocol-client';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useScoutConfig } from '@/store/config-store';
import { useBusyState, useTreeNavigationAdmission } from '@/store/conversation-store';
import { useSessionFile, useSessionId } from '@/store/session-store';
import { useTree, useTreeLeafId } from '@/store/tree-store';
import {
  buildVisibleNodes,
  flattenTree,
  getEffectiveSelectedId,
  indexNodes,
  isVisibleDescendant,
} from '../model/tree-model';
import type {
  FilterMode,
  LabelDraftState,
  SummaryDraftState,
  SummaryMode,
} from '../model/tree-types';

export const TREE_SEARCH_DEBOUNCE_MS = 160;

type NavigationState =
  | { kind: 'idle' }
  | {
      kind: 'running' | 'aborting';
      navigationId: string;
      origin: 'host' | 'local';
      summarize: boolean;
    };

type NavigationAction =
  | { type: 'start'; navigationId: string; summarize: boolean }
  | { type: 'abort'; navigationId: string; summarize: boolean }
  | { type: 'reset' };

function reduceNavigation(state: NavigationState, action: NavigationAction): NavigationState {
  switch (action.type) {
    case 'start':
      return {
        kind: 'running',
        navigationId: action.navigationId,
        origin: 'local',
        summarize: action.summarize,
      };
    case 'abort':
      if (state.kind !== 'idle' && state.navigationId === action.navigationId) {
        return { ...state, kind: 'aborting' };
      }
      return {
        kind: 'aborting',
        navigationId: action.navigationId,
        origin: 'host',
        summarize: action.summarize,
      };
    case 'reset':
      return { kind: 'idle' };
  }
}

function createNavigationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `tree-${Date.now()}-${Math.random()}`;
}

export function useTreePanelController() {
  const tree = useTree();
  const leafId = useTreeLeafId();
  const sessionId = useSessionId();
  const sessionFile = useSessionFile();
  const skipSummaryPrompt = useScoutConfig()?.branchSummary.skipPrompt ?? false;
  const busyState = useBusyState();
  const treeNavigationAdmission = useTreeNavigationAdmission();
  const sessionBusy = busyState.kind !== 'idle';
  const [query, setQuery] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('default');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [foldedIds, setFoldedIds] = useState<Set<string>>(() => new Set());
  const [summaryDraft, setSummaryDraft] = useState<SummaryDraftState | null>(null);
  const [labelDraft, setLabelDraft] = useState<LabelDraftState | null>(null);
  const [labelSavedNodeId, setLabelSavedNodeId] = useState<string | null>(null);
  const [summaryDialogOpen, setSummaryDialogOpen] = useState(false);
  const [summaryOptionsVisible, setSummaryOptionsVisible] = useState(true);
  const [navigationBlockedDialogOpen, setNavigationBlockedDialogOpen] = useState(false);
  const [navigationState, dispatchNavigation] = useReducer(reduceNavigation, { kind: 'idle' });
  const navigationRequestRef = useRef<ReturnType<typeof protocolClient.navigateTree> | null>(null);
  const labelSaveSeqRef = useRef(0);
  const debouncedQuery = useDebouncedValue(query, TREE_SEARCH_DEBOUNCE_MS);

  const flatNodes = useMemo(() => flattenTree(tree), [tree]);
  const nodeById = useMemo(() => indexNodes(flatNodes), [flatNodes]);
  const visibleNodes = useMemo(
    () => buildVisibleNodes(flatNodes, foldedIds, filterMode, debouncedQuery),
    [debouncedQuery, filterMode, flatNodes, foldedIds],
  );
  const effectiveSelectedId = getEffectiveSelectedId(selectedId, leafId, visibleNodes);
  const selectedNode = effectiveSelectedId ? nodeById.get(effectiveSelectedId)?.node : undefined;
  const selectedNodeIdRef = useRef<string | null>(null);
  const nodeByIdRef = useRef(nodeById);

  useLayoutEffect(() => {
    selectedNodeIdRef.current = selectedNode?.id ?? null;
    nodeByIdRef.current = nodeById;
  }, [nodeById, selectedNode?.id]);

  useLayoutEffect(
    () => () => {
      navigationRequestRef.current?.cancel();
      navigationRequestRef.current = null;
    },
    [],
  );

  const hostNavigationId = busyState.kind === 'tree_navigation' ? busyState.operationId : undefined;
  const activeNavigationPending = useMemo(() => {
    if (!sessionId || !sessionFile) return null;
    const local =
      navigationState.kind === 'idle'
        ? null
        : {
            navigationId: navigationState.navigationId,
            session: { sessionId, sessionPath: sessionFile },
            summarize: navigationState.summarize,
            cancellable: true,
            aborting: navigationState.kind === 'aborting',
          };
    if (busyState.kind !== 'tree_navigation') return local;
    const matchesLocal = local?.navigationId === busyState.operationId;
    return {
      navigationId: busyState.operationId,
      session: { sessionId, sessionPath: sessionFile },
      summarize: matchesLocal ? local.summarize : false,
      cancellable: busyState.cancellable,
      aborting: matchesLocal ? local.aborting : false,
    };
  }, [busyState, navigationState, sessionFile, sessionId]);

  useLayoutEffect(() => {
    if (navigationState.kind === 'idle' || navigationState.origin !== 'host') return;
    if (hostNavigationId === navigationState.navigationId) return;
    dispatchNavigation({ type: 'reset' });
  }, [hostNavigationId, navigationState]);

  const effectiveLabelDraft =
    selectedNode && labelDraft?.nodeId === selectedNode.id
      ? labelDraft.value
      : (selectedNode?.label ?? '');
  const effectiveSummaryDraft = useMemo(
    () =>
      selectedNode && summaryDraft?.nodeId === selectedNode.id
        ? summaryDraft
        : { nodeId: selectedNode?.id ?? '', mode: 'none' as const, customInstructions: '' },
    [selectedNode, summaryDraft],
  );

  const toggleFold = useCallback(
    (entryId: string) => {
      const shouldFold = !foldedIds.has(entryId);
      if (
        shouldFold &&
        effectiveSelectedId &&
        effectiveSelectedId !== entryId &&
        isVisibleDescendant(effectiveSelectedId, entryId, visibleNodes)
      ) {
        setSelectedId(entryId);
      }
      setFoldedIds((current) => {
        const next = new Set(current);
        if (next.has(entryId)) {
          next.delete(entryId);
        } else {
          next.add(entryId);
        }
        return next;
      });
    },
    [effectiveSelectedId, foldedIds, visibleNodes],
  );

  const updateQuery = useCallback(
    (value: string) => {
      if (value !== query) {
        setFoldedIds(new Set());
      }
      setQuery(value);
    },
    [query],
  );

  const updateFilterMode = useCallback(
    (mode: FilterMode) => {
      if (mode !== filterMode) {
        setFoldedIds(new Set());
      }
      setFilterMode(mode);
    },
    [filterMode],
  );

  const revealCurrentLeaf = useCallback(() => {
    if (!leafId) return;
    setSelectedId(leafId);
    setQuery('');
    setFilterMode('default');
    setFoldedIds(new Set());
  }, [leafId]);

  const saveLabel = useCallback(() => {
    if (!selectedNode || !sessionId || !sessionFile || sessionBusy || navigationRequestRef.current)
      return;
    const nodeId = selectedNode.id;
    const label = effectiveLabelDraft.trim() || undefined;
    const saveSeq = labelSaveSeqRef.current + 1;
    labelSaveSeqRef.current = saveSeq;
    setLabelSavedNodeId(null);
    protocolClient.setLabel({ sessionId, sessionPath: sessionFile }, nodeId, label, (payload) => {
      if (!payload.success) return;
      if (labelSaveSeqRef.current !== saveSeq) return;
      if (selectedNodeIdRef.current !== nodeId) return;
      if (!nodeByIdRef.current.has(nodeId)) return;
      setLabelSavedNodeId(nodeId);
    });
  }, [effectiveLabelDraft, selectedNode, sessionBusy, sessionFile, sessionId]);

  const navigateWithSummaryMode = useCallback(
    (mode: SummaryMode) => {
      if (!selectedNode || !sessionId || !sessionFile || navigationRequestRef.current) return;
      if (!treeNavigationAdmission.allowed) {
        setSummaryDialogOpen(false);
        setNavigationBlockedDialogOpen(true);
        return;
      }
      const summarize = mode !== 'none';
      const navigationId = createNavigationId();
      const session = { sessionId, sessionPath: sessionFile };
      dispatchNavigation({ type: 'start', navigationId, summarize });
      setSummaryDialogOpen(false);
      const clearPending = () => {
        if (navigationRequestRef.current !== request) return;
        navigationRequestRef.current = null;
        dispatchNavigation({ type: 'reset' });
      };
      const request = protocolClient.navigateTree(
        {
          navigationId,
          session,
          targetId: selectedNode.id,
          summarize,
          customInstructions:
            mode === 'custom'
              ? effectiveSummaryDraft.customInstructions.trim() || undefined
              : undefined,
        },
        clearPending,
        clearPending,
      );
      navigationRequestRef.current = request;
    },
    [
      effectiveSummaryDraft.customInstructions,
      selectedNode,
      sessionFile,
      sessionId,
      treeNavigationAdmission,
    ],
  );

  const navigateToSelectedNode = useCallback(() => {
    if (!selectedNode || navigationRequestRef.current) return;
    if (!treeNavigationAdmission.allowed) {
      setNavigationBlockedDialogOpen(true);
      return;
    }
    const reopensComposer = selectedNode.kind === 'user' || selectedNode.kind === 'custom';
    if (skipSummaryPrompt && !reopensComposer) {
      navigateWithSummaryMode('none');
      return;
    }
    setSummaryOptionsVisible(!skipSummaryPrompt);
    setSummaryDialogOpen(true);
  }, [navigateWithSummaryMode, selectedNode, skipSummaryPrompt, treeNavigationAdmission]);

  const openSummaryOptions = useCallback(() => {
    if (!selectedNode || navigationRequestRef.current) return;
    if (!treeNavigationAdmission.allowed) {
      setNavigationBlockedDialogOpen(true);
      return;
    }
    setSummaryOptionsVisible(true);
    setSummaryDialogOpen(true);
  }, [selectedNode, treeNavigationAdmission]);

  const confirmNavigation = useCallback(() => {
    navigateWithSummaryMode(summaryOptionsVisible ? effectiveSummaryDraft.mode : 'none');
  }, [effectiveSummaryDraft.mode, navigateWithSummaryMode, summaryOptionsVisible]);

  const abortNavigation = useCallback(() => {
    if (
      !activeNavigationPending ||
      !activeNavigationPending.cancellable ||
      activeNavigationPending.aborting
    )
      return;
    dispatchNavigation({
      type: 'abort',
      navigationId: activeNavigationPending.navigationId,
      summarize: activeNavigationPending.summarize,
    });
    protocolClient.abortTreeNavigation(
      activeNavigationPending.navigationId,
      activeNavigationPending.session,
    );
  }, [activeNavigationPending]);

  const updateCustomInstructions = useCallback(
    (value: string) => {
      if (!selectedNode) return;
      setSummaryDraft({
        nodeId: selectedNode.id,
        mode: 'custom',
        customInstructions: value,
      });
    },
    [selectedNode],
  );

  const updateLabelDraft = useCallback(
    (value: string) => {
      if (!selectedNode) return;
      setLabelDraft({ nodeId: selectedNode.id, value });
      setLabelSavedNodeId(null);
    },
    [selectedNode],
  );

  const updateSummaryMode = useCallback(
    (mode: SummaryMode) => {
      if (!selectedNode) return;
      setSummaryDraft({
        nodeId: selectedNode.id,
        mode,
        customInstructions: mode === 'custom' ? effectiveSummaryDraft.customInstructions : '',
      });
    },
    [effectiveSummaryDraft.customInstructions, selectedNode],
  );

  return {
    effectiveLabelDraft,
    effectiveSelectedId,
    effectiveSummaryDraft,
    filterMode,
    foldedIds,
    labelSavedNodeId,
    leafId,
    query,
    navigationPending: activeNavigationPending,
    interactionLocked: activeNavigationPending !== null,
    sessionMutationLocked: activeNavigationPending !== null || sessionBusy,
    navigationActionDisabled:
      activeNavigationPending !== null || !sessionId || !sessionFile || !selectedNode,
    navigationBlockedDialogOpen,
    navigationBlockedMessage: treeNavigationAdmission.allowed
      ? ''
      : treeNavigationAdmission.message,
    summaryDialogOpen,
    summaryOptionsVisible,
    reopensComposer: selectedNode?.kind === 'user' || selectedNode?.kind === 'custom',
    selectedNode,
    visibleNodes,
    abortNavigation,
    confirmNavigation,
    navigateWithSummaryMode,
    navigateToSelectedNode,
    openSummaryOptions,
    refreshTree: protocolClient.requestTree,
    revealCurrentLeaf,
    saveLabel,
    setFilterMode: updateFilterMode,
    setQuery: updateQuery,
    setSelectedId,
    setNavigationBlockedDialogOpen,
    setSummaryDialogOpen,
    toggleFold,
    updateCustomInstructions,
    updateLabelDraft,
    updateSummaryMode,
  };
}

// ============================================================
// Tree Panel Controller — 会话树面板状态与协议动作
// ============================================================

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { protocolClient } from '@/bridge/protocol-client';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
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

export function useTreePanelController() {
  const tree = useTree();
  const leafId = useTreeLeafId();
  const [query, setQuery] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('default');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [foldedIds, setFoldedIds] = useState<Set<string>>(() => new Set());
  const [summaryDraft, setSummaryDraft] = useState<SummaryDraftState | null>(null);
  const [labelDraft, setLabelDraft] = useState<LabelDraftState | null>(null);
  const [labelSavedNodeId, setLabelSavedNodeId] = useState<string | null>(null);
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
    if (!selectedNode) return;
    const nodeId = selectedNode.id;
    const label = effectiveLabelDraft.trim() || undefined;
    const saveSeq = labelSaveSeqRef.current + 1;
    labelSaveSeqRef.current = saveSeq;
    setLabelSavedNodeId(null);
    protocolClient.setLabel(nodeId, label, (payload) => {
      if (!payload.success) return;
      if (labelSaveSeqRef.current !== saveSeq) return;
      if (selectedNodeIdRef.current !== nodeId) return;
      if (!nodeByIdRef.current.has(nodeId)) return;
      setLabelSavedNodeId(nodeId);
    });
  }, [effectiveLabelDraft, selectedNode]);

  const navigateToSelectedNode = useCallback(() => {
    if (!selectedNode) return;
    protocolClient.navigateTree({
      targetId: selectedNode.id,
      summarize: effectiveSummaryDraft.mode !== 'none',
      customInstructions:
        effectiveSummaryDraft.mode === 'custom'
          ? effectiveSummaryDraft.customInstructions.trim() || undefined
          : undefined,
    });
  }, [effectiveSummaryDraft, selectedNode]);

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
    selectedNode,
    visibleNodes,
    navigateToSelectedNode,
    refreshTree: protocolClient.requestTree,
    revealCurrentLeaf,
    saveLabel,
    setFilterMode: updateFilterMode,
    setQuery: updateQuery,
    setSelectedId,
    toggleFold,
    updateCustomInstructions,
    updateLabelDraft,
    updateSummaryMode,
  };
}

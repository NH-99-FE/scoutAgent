// ============================================================
// Tree Panel Controller — 会话树面板状态与协议动作
// ============================================================

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { protocolClient } from '@/bridge/protocol-client';
import { useTree, useTreeLeafId } from '@/store/tree-store';
import {
  buildVisibleNodes,
  flattenTree,
  getEffectiveSelectedId,
  indexNodes,
  isVisibleDescendant,
} from './tree-model';
import type { FilterMode, LabelDraftState, SummaryDraftState, SummaryMode } from './tree-types';

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

  const flatNodes = useMemo(() => flattenTree(tree), [tree]);
  const nodeById = useMemo(() => indexNodes(flatNodes), [flatNodes]);
  const visibleNodes = useMemo(
    () => buildVisibleNodes(flatNodes, foldedIds, filterMode, query),
    [filterMode, flatNodes, foldedIds, query],
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
  const effectiveSummaryDraft =
    selectedNode && summaryDraft?.nodeId === selectedNode.id
      ? summaryDraft
      : { nodeId: selectedNode?.id ?? '', mode: 'none' as const, customInstructions: '' };

  const toggleFold = (entryId: string) => {
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
  };

  const revealCurrentLeaf = () => {
    if (!leafId) return;
    setSelectedId(leafId);
    setQuery('');
    setFilterMode('default');
    setFoldedIds(new Set());
  };

  const saveLabel = () => {
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
  };

  const navigateToSelectedNode = () => {
    if (!selectedNode) return;
    protocolClient.navigateTree({
      targetId: selectedNode.id,
      summarize: effectiveSummaryDraft.mode !== 'none',
      customInstructions:
        effectiveSummaryDraft.mode === 'custom'
          ? effectiveSummaryDraft.customInstructions.trim() || undefined
          : undefined,
    });
  };

  const updateCustomInstructions = (value: string) => {
    if (!selectedNode) return;
    setSummaryDraft({
      nodeId: selectedNode.id,
      mode: 'custom',
      customInstructions: value,
    });
  };

  const updateLabelDraft = (value: string) => {
    if (!selectedNode) return;
    setLabelDraft({ nodeId: selectedNode.id, value });
    setLabelSavedNodeId(null);
  };

  const updateSummaryMode = (mode: SummaryMode) => {
    if (!selectedNode) return;
    setSummaryDraft({
      nodeId: selectedNode.id,
      mode,
      customInstructions: mode === 'custom' ? effectiveSummaryDraft.customInstructions : '',
    });
  };

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
    setFilterMode,
    setQuery,
    setSelectedId,
    toggleFold,
    updateCustomInstructions,
    updateLabelDraft,
    updateSummaryMode,
  };
}

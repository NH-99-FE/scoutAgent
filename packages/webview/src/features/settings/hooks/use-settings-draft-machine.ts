// ============================================================
// Settings Draft Machine — 设置草稿 baseline/draft 状态机
// ============================================================

import { useCallback, useLayoutEffect, useReducer, useRef } from 'react';

interface SettingsDraftMachineState<TDraft, TScope extends string> {
  baseline: TDraft;
  draft: TDraft;
  scopeRevisions: Record<TScope, number>;
}

export interface SavedDraftMergeContext<TDraft, TScope extends string> {
  draft: TDraft;
  previousBaseline: TDraft;
  nextBaseline: TDraft;
  saveScope: TScope;
  scopeUnchanged: boolean;
  dirtyScopesBeforeSave: Record<TScope, boolean>;
}

export interface RebasedDraftMergeContext<TDraft, TScope extends string> {
  draft: TDraft;
  previousBaseline: TDraft;
  nextBaseline: TDraft;
  dirtyScopes: Record<TScope, boolean>;
}

type SettingsDraftMachineAction<TDraft, TScope extends string> =
  | { type: 'hydrate'; draft: TDraft }
  | { type: 'edit'; scope: TScope; update: (draft: TDraft) => TDraft }
  | { type: 'replace'; update: (draft: TDraft) => TDraft }
  | { type: 'discard'; restore: (baseline: TDraft, draft: TDraft) => TDraft }
  | {
      type: 'rebase';
      baseline: TDraft;
      merge: (context: RebasedDraftMergeContext<TDraft, TScope>) => TDraft;
    }
  | {
      type: 'save_succeeded';
      scope: TScope;
      submittedScopeRevision: number;
      baseline: TDraft;
      merge: (context: SavedDraftMergeContext<TDraft, TScope>) => TDraft;
    };

export interface SettingsDraftMachine<TDraft, TScope extends string> {
  baseline: TDraft;
  draft: TDraft;
  dirtyScopes: Record<TScope, boolean>;
  hasUnsavedChanges: boolean;
  hydrate: (draft: TDraft) => void;
  edit: (scope: TScope, update: (draft: TDraft) => TDraft) => void;
  replace: (update: (draft: TDraft) => TDraft) => void;
  discard: (restore: (baseline: TDraft, draft: TDraft) => TDraft) => void;
  rebase: (
    baseline: TDraft,
    merge: (context: RebasedDraftMergeContext<TDraft, TScope>) => TDraft,
  ) => void;
  commitSaved: (options: {
    scope: TScope;
    submittedScopeRevision: number;
    baseline: TDraft;
    merge: (context: SavedDraftMergeContext<TDraft, TScope>) => TDraft;
  }) => void;
  getSnapshot: () => SettingsDraftMachineState<TDraft, TScope>;
  getScopeRevision: (scope: TScope) => number;
}

export function useSettingsDraftMachine<TDraft, TScope extends string>({
  initialDraft,
  scopes,
  isScopeDirty,
}: {
  initialDraft: TDraft;
  scopes: readonly TScope[];
  isScopeDirty: (draft: TDraft, baseline: TDraft, scope: TScope) => boolean;
}): SettingsDraftMachine<TDraft, TScope> {
  const reducer = useCallback(
    (
      state: SettingsDraftMachineState<TDraft, TScope>,
      action: SettingsDraftMachineAction<TDraft, TScope>,
    ): SettingsDraftMachineState<TDraft, TScope> => {
      if (action.type === 'hydrate') {
        return {
          baseline: action.draft,
          draft: action.draft,
          scopeRevisions: incrementAllScopeRevisions(state.scopeRevisions, scopes),
        };
      }
      if (action.type === 'edit') {
        return {
          ...state,
          draft: action.update(state.draft),
          scopeRevisions: incrementScopeRevision(state.scopeRevisions, action.scope),
        };
      }
      if (action.type === 'replace') {
        return { ...state, draft: action.update(state.draft) };
      }
      if (action.type === 'discard') {
        return {
          ...state,
          draft: action.restore(state.baseline, state.draft),
          scopeRevisions: incrementAllScopeRevisions(state.scopeRevisions, scopes),
        };
      }

      if (action.type === 'rebase') {
        return {
          ...state,
          baseline: action.baseline,
          draft: action.merge({
            draft: state.draft,
            previousBaseline: state.baseline,
            nextBaseline: action.baseline,
            dirtyScopes: projectDirtyScopes(state, scopes, isScopeDirty),
          }),
        };
      }

      const dirtyScopesBeforeSave = projectDirtyScopes(state, scopes, isScopeDirty);
      const scopeUnchanged = state.scopeRevisions[action.scope] === action.submittedScopeRevision;
      return {
        baseline: action.baseline,
        draft: action.merge({
          draft: state.draft,
          previousBaseline: state.baseline,
          nextBaseline: action.baseline,
          saveScope: action.scope,
          scopeUnchanged,
          dirtyScopesBeforeSave,
        }),
        scopeRevisions: incrementScopeRevision(state.scopeRevisions, action.scope),
      };
    },
    [isScopeDirty, scopes],
  );

  const [state, reactDispatch] = useReducer(reducer, {
    baseline: initialDraft,
    draft: initialDraft,
    scopeRevisions: createScopeRecord(scopes, 0),
  });
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);
  const dispatch = reactDispatch;

  const dirtyScopes = projectDirtyScopes(state, scopes, isScopeDirty);
  const hydrate = useCallback((draft: TDraft) => dispatch({ type: 'hydrate', draft }), [dispatch]);
  const edit = useCallback(
    (scope: TScope, update: (draft: TDraft) => TDraft) => dispatch({ type: 'edit', scope, update }),
    [dispatch],
  );
  const replace = useCallback(
    (update: (draft: TDraft) => TDraft) => dispatch({ type: 'replace', update }),
    [dispatch],
  );
  const discard = useCallback(
    (restore: (baseline: TDraft, draft: TDraft) => TDraft) =>
      dispatch({ type: 'discard', restore }),
    [dispatch],
  );
  const rebase = useCallback(
    (baseline: TDraft, merge: (context: RebasedDraftMergeContext<TDraft, TScope>) => TDraft) =>
      dispatch({ type: 'rebase', baseline, merge }),
    [dispatch],
  );
  const commitSaved = useCallback(
    (options: {
      scope: TScope;
      submittedScopeRevision: number;
      baseline: TDraft;
      merge: (context: SavedDraftMergeContext<TDraft, TScope>) => TDraft;
    }) => dispatch({ type: 'save_succeeded', ...options }),
    [dispatch],
  );
  const getSnapshot = useCallback(() => stateRef.current, []);
  const getScopeRevision = useCallback(
    (scope: TScope) => stateRef.current.scopeRevisions[scope],
    [],
  );
  return {
    baseline: state.baseline,
    draft: state.draft,
    dirtyScopes,
    hasUnsavedChanges: scopes.some((scope) => dirtyScopes[scope]),
    hydrate,
    edit,
    replace,
    discard,
    rebase,
    commitSaved,
    getSnapshot,
    getScopeRevision,
  };
}

function projectDirtyScopes<TDraft, TScope extends string>(
  state: Pick<SettingsDraftMachineState<TDraft, TScope>, 'baseline' | 'draft'>,
  scopes: readonly TScope[],
  isScopeDirty: (draft: TDraft, baseline: TDraft, scope: TScope) => boolean,
): Record<TScope, boolean> {
  return Object.fromEntries(
    scopes.map((scope) => [scope, isScopeDirty(state.draft, state.baseline, scope)]),
  ) as Record<TScope, boolean>;
}

function createScopeRecord<TScope extends string, TValue>(
  scopes: readonly TScope[],
  value: TValue,
): Record<TScope, TValue> {
  return Object.fromEntries(scopes.map((scope) => [scope, value])) as Record<TScope, TValue>;
}

function incrementScopeRevision<TScope extends string>(
  revisions: Record<TScope, number>,
  scope: TScope,
): Record<TScope, number> {
  return { ...revisions, [scope]: revisions[scope] + 1 };
}

function incrementAllScopeRevisions<TScope extends string>(
  revisions: Record<TScope, number>,
  scopes: readonly TScope[],
): Record<TScope, number> {
  return Object.fromEntries(scopes.map((scope) => [scope, revisions[scope] + 1])) as Record<
    TScope,
    number
  >;
}

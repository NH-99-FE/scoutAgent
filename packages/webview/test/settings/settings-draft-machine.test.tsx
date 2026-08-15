import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  useSettingsDraftMachine,
  type SavedDraftMergeContext,
} from '@/features/settings/hooks/use-settings-draft-machine';

const SCOPES = ['global', 'project'] as const;
type Scope = (typeof SCOPES)[number];

interface TestDraft {
  selectedScope: Scope;
  values: Record<Scope, string>;
}

const INITIAL_DRAFT: TestDraft = {
  selectedScope: 'global',
  values: { global: 'global', project: 'project' },
};

describe('useSettingsDraftMachine', () => {
  it('derives dirty state, discards locally, and preserves another dirty scope on save', () => {
    const { result } = renderHook(() =>
      useSettingsDraftMachine({
        initialDraft: INITIAL_DRAFT,
        scopes: SCOPES,
        isScopeDirty: (draft, baseline, scope) => draft.values[scope] !== baseline.values[scope],
      }),
    );

    act(() =>
      result.current.edit('project', (current) => ({
        ...current,
        values: { ...current.values, project: 'project-draft' },
      })),
    );
    expect(result.current.dirtyScopes).toEqual({ global: false, project: true });

    act(() =>
      result.current.edit('global', (current) => ({
        ...current,
        values: { ...current.values, global: 'global-saved' },
      })),
    );
    const submittedScopeRevision = result.current.getScopeRevision('global');
    act(() =>
      result.current.commitSaved({
        scope: 'global',
        submittedScopeRevision,
        baseline: {
          selectedScope: 'global',
          values: { global: 'global-saved', project: 'project-on-server' },
        },
        merge: mergeSavedTestDraft,
      }),
    );

    expect(result.current.draft.values).toEqual({
      global: 'global-saved',
      project: 'project-draft',
    });
    expect(result.current.dirtyScopes).toEqual({ global: false, project: true });

    act(() =>
      result.current.discard((baseline, current) => ({
        ...baseline,
        selectedScope: current.selectedScope,
      })),
    );
    expect(result.current.draft.values).toEqual({
      global: 'global-saved',
      project: 'project-on-server',
    });
    expect(result.current.hasUnsavedChanges).toBe(false);
  });

  it('clears dirty state when an edit returns to the baseline', () => {
    const { result } = renderHook(() =>
      useSettingsDraftMachine({
        initialDraft: INITIAL_DRAFT,
        scopes: SCOPES,
        isScopeDirty: (draft, baseline, scope) => draft.values[scope] !== baseline.values[scope],
      }),
    );

    act(() =>
      result.current.edit('global', (current) => ({
        ...current,
        values: { ...current.values, global: 'draft' },
      })),
    );
    act(() =>
      result.current.edit('global', (current) => ({
        ...current,
        values: { ...current.values, global: 'global' },
      })),
    );

    expect(result.current.dirtyScopes.global).toBe(false);
  });
});

function mergeSavedTestDraft({
  draft,
  nextBaseline,
  saveScope,
  scopeUnchanged,
  dirtyScopesBeforeSave,
}: SavedDraftMergeContext<TestDraft, Scope>): TestDraft {
  const next = {
    ...nextBaseline,
    selectedScope: draft.selectedScope,
    values: { ...nextBaseline.values },
  };
  for (const scope of SCOPES) {
    const preserve = scope === saveScope ? !scopeUnchanged : dirtyScopesBeforeSave[scope];
    if (preserve) next.values[scope] = draft.values[scope];
  }
  return next;
}

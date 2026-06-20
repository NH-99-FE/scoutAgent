import { afterEach, describe, expect, it } from 'vitest';
import { useConversationExpansionStore } from '@/store/conversation-expansion-store';

describe('conversation expansion store', () => {
  afterEach(() => {
    useConversationExpansionStore.getState().actions.reset();
  });

  it('collapses descendants when a parent closes', () => {
    const { actions } = useConversationExpansionStore.getState();

    actions.registerNode({ id: 'turn-1', kind: 'assistant_turn' });
    actions.registerNode({ id: 'process-1', kind: 'process', parentId: 'turn-1' });
    actions.registerNode({
      id: 'tool-detail-1',
      kind: 'tool_detail',
      parentId: 'process-1',
    });

    actions.setExpanded('turn-1', true);
    actions.setExpanded('process-1', true);
    actions.setExpanded('tool-detail-1', true);
    actions.setExpanded('turn-1', false);

    expect(useConversationExpansionStore.getState().expandedById).toMatchObject({
      'turn-1': false,
      'process-1': false,
      'tool-detail-1': false,
    });
  });

  it('keeps ancestors open when an intermediate node closes', () => {
    const { actions } = useConversationExpansionStore.getState();

    actions.registerNode({ id: 'turn-1', kind: 'assistant_turn' });
    actions.registerNode({ id: 'process-1', kind: 'process', parentId: 'turn-1' });
    actions.registerNode({
      id: 'tool-detail-1',
      kind: 'tool_detail',
      parentId: 'process-1',
    });

    actions.setExpanded('turn-1', true);
    actions.setExpanded('process-1', true);
    actions.setExpanded('tool-detail-1', true);
    actions.setExpanded('process-1', false);

    expect(useConversationExpansionStore.getState().expandedById).toMatchObject({
      'turn-1': true,
      'process-1': false,
      'tool-detail-1': false,
    });
  });

  it('unregisters descendants with their parent', () => {
    const { actions } = useConversationExpansionStore.getState();

    actions.registerNode({ id: 'turn-1', kind: 'assistant_turn' });
    actions.registerNode({ id: 'process-1', kind: 'process', parentId: 'turn-1' });
    actions.registerNode({
      id: 'tool-detail-1',
      kind: 'tool_detail',
      parentId: 'process-1',
    });
    actions.setExpanded('process-1', true);
    actions.setExpanded('tool-detail-1', true);

    actions.unregisterNode('process-1');

    expect(useConversationExpansionStore.getState().nodesById).toEqual({
      'turn-1': { id: 'turn-1', kind: 'assistant_turn' },
    });
    expect(useConversationExpansionStore.getState().expandedById).toEqual({});
  });
});

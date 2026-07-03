import { describe, expect, it } from 'vitest';
import { projectSessionBranchToScoutMessages } from '../../../src/host/protocol/session-message-projector.ts';
import { SessionManager } from '../../../src/core/session/index.ts';
import { assistantMessage, mockModel, userMessage } from '../../core/test-utils.ts';

describe('session message projector', () => {
  it('keeps projected messages in session timeline order after compaction', () => {
    const session = SessionManager.inMemory();
    session.appendMessage(userMessage('old prompt'));
    session.appendMessage(assistantMessage('old reply'));
    const keptUserId = session.appendMessage(userMessage('kept prompt'));
    const keptAssistantId = session.appendMessage(assistantMessage('kept reply'));
    const compactionId = session.appendCompaction('Compacted context', keptUserId, 1234);
    const generatedDocId = session.appendCustomMessageEntry(
      'generated-md',
      '# Generated document',
      true,
    );
    session.appendCustomMessageEntry('hidden-style', 'hidden style context', false);

    expect(
      projectSessionBranchToScoutMessages(session.getBranch()).map((message) => ({
        role: message.role,
        text:
          message.role === 'user'
            ? message.content
            : message.role === 'assistant'
              ? message.content.find((part) => part.type === 'text')?.text
              : message.role === 'compactionSummary'
                ? message.summary
                : message.role === 'custom'
                  ? message.content
                  : undefined,
        entryId: message.entryId,
      })),
    ).toEqual([
      { role: 'user', text: 'kept prompt', entryId: keptUserId },
      { role: 'assistant', text: 'kept reply', entryId: keptAssistantId },
      { role: 'compactionSummary', text: 'Compacted context', entryId: compactionId },
      { role: 'custom', text: '# Generated document', entryId: generatedDocId },
    ]);
  });

  it('anchors compaction projection after the nearest visible message when the kept entry is hidden', () => {
    const session = SessionManager.inMemory();
    session.appendMessage(userMessage('old prompt'));
    session.appendMessage(assistantMessage('old reply'));
    session.appendMessage(userMessage('kept prompt'));
    const keptAssistantId = session.appendMessage(assistantMessage('kept reply'));
    const hiddenStyleId = session.appendCustomMessageEntry('hidden-style', 'style context', false);
    const compactionId = session.appendCompaction(
      'Compacted context with generated markdown',
      hiddenStyleId,
      1234,
    );
    const generatedDocId = session.appendCustomMessageEntry(
      'generated-md',
      '# Generated document',
      true,
    );

    expect(
      projectSessionBranchToScoutMessages(session.getBranch()).map((message) => ({
        role: message.role,
        text:
          message.role === 'assistant'
            ? message.content.find((part) => part.type === 'text')?.text
            : message.role === 'compactionSummary'
              ? message.summary
              : message.role === 'custom'
                ? message.content
                : undefined,
        entryId: message.entryId,
      })),
    ).toEqual([
      { role: 'assistant', text: 'kept reply', entryId: keptAssistantId },
      {
        role: 'compactionSummary',
        text: 'Compacted context with generated markdown',
        entryId: compactionId,
      },
      { role: 'custom', text: '# Generated document', entryId: generatedDocId },
    ]);
  });

  it('starts projection at the first visible message when the kept entry is metadata', () => {
    const session = SessionManager.inMemory();
    const selectedModel = mockModel();
    const modelEntryId = session.appendModelChange(selectedModel.provider, selectedModel.id);
    session.appendThinkingLevelChange('off');
    const userEntryId = session.appendMessage(userMessage('kept prompt'));
    const assistantEntryId = session.appendMessage(assistantMessage('kept reply'));
    const compactionId = session.appendCompaction('Compacted context', modelEntryId, 1234);

    expect(
      projectSessionBranchToScoutMessages(session.getBranch()).map((message) => ({
        role: message.role,
        text:
          message.role === 'user'
            ? message.content
            : message.role === 'assistant'
              ? message.content.find((part) => part.type === 'text')?.text
              : message.role === 'compactionSummary'
                ? message.summary
                : undefined,
        entryId: message.entryId,
      })),
    ).toEqual([
      { role: 'user', text: 'kept prompt', entryId: userEntryId },
      { role: 'assistant', text: 'kept reply', entryId: assistantEntryId },
      { role: 'compactionSummary', text: 'Compacted context', entryId: compactionId },
    ]);
  });

  it('starts at the compaction entry when firstKeptEntryId is missing', () => {
    const session = SessionManager.inMemory();
    session.appendMessage(userMessage('old prompt'));
    session.appendMessage(assistantMessage('old reply'));
    const compactionId = session.appendCompaction('Compacted context', 'missing-entry', 1234);

    const projectedMessages = projectSessionBranchToScoutMessages(session.getBranch());

    expect(projectedMessages.map((message) => message.entryId)).toEqual([compactionId]);
    expect(projectedMessages.map((message) => message.role)).toEqual(['compactionSummary']);
  });

  it('starts at the compaction entry when firstKeptEntryId points after compaction', () => {
    const session = SessionManager.inMemory();
    session.appendMessage(userMessage('old prompt'));
    session.appendMessage(assistantMessage('old reply'));
    const compactionId = session.appendCompaction('Compacted context', 'temporary-entry', 1234);
    const afterCompactionId = session.appendMessage(userMessage('after compaction'));
    const branch = session
      .getBranch()
      .map((entry) =>
        entry.id === compactionId && entry.type === 'compaction'
          ? { ...entry, firstKeptEntryId: afterCompactionId }
          : entry,
      );

    const projectedMessages = projectSessionBranchToScoutMessages(branch);

    expect(projectedMessages.map((message) => message.entryId)).toEqual([
      compactionId,
      afterCompactionId,
    ]);
    expect(projectedMessages.map((message) => message.role)).toEqual(['compactionSummary', 'user']);
  });

  it('does not project older compaction summaries retained by the latest compaction range', () => {
    const session = SessionManager.inMemory();
    session.appendMessage(userMessage('old prompt'));
    session.appendMessage(assistantMessage('old reply'));
    const keptUserId = session.appendMessage(userMessage('kept before first compaction'));
    const keptAssistantId = session.appendMessage(assistantMessage('kept assistant reply'));
    session.appendCompaction('Older compaction summary', keptUserId, 1000);
    const afterFirstCompactionId = session.appendMessage(userMessage('after first compaction'));
    const latestCompactionId = session.appendCompaction(
      'Latest compaction summary',
      keptUserId,
      2000,
    );

    expect(
      projectSessionBranchToScoutMessages(session.getBranch()).map((message) => ({
        role: message.role,
        text:
          message.role === 'user'
            ? message.content
            : message.role === 'assistant'
              ? message.content.find((part) => part.type === 'text')?.text
              : message.role === 'compactionSummary'
                ? message.summary
                : undefined,
        entryId: message.entryId,
      })),
    ).toEqual([
      { role: 'user', text: 'kept before first compaction', entryId: keptUserId },
      { role: 'assistant', text: 'kept assistant reply', entryId: keptAssistantId },
      { role: 'user', text: 'after first compaction', entryId: afterFirstCompactionId },
      {
        role: 'compactionSummary',
        text: 'Latest compaction summary',
        entryId: latestCompactionId,
      },
    ]);
  });

  it('attaches changes review summaries to assistant messages from paired file change results', () => {
    const session = SessionManager.inMemory();
    session.appendMessage(userMessage('edit app'));
    session.appendMessage(
      assistantMessage('', {
        content: [
          {
            type: 'toolCall',
            id: 'tool-1',
            name: 'edit',
            arguments: { path: '/workspace/src/app.ts' },
          },
        ],
        stopReason: 'toolUse',
      }),
    );
    session.appendMessage({
      role: 'toolResult',
      toolCallId: 'tool-1',
      toolName: 'edit',
      content: [],
      details: {
        kind: 'file_change',
        path: '/workspace/src/app.ts',
        additions: 2,
        deletions: 1,
        review: { turnId: 'turn-1', recordId: 'record-1' },
      },
      isError: false,
      timestamp: 3,
    });

    const messages = projectSessionBranchToScoutMessages(session.getBranch(), {
      resolveChangesReviewSummary: (turnId) =>
        turnId === 'turn-1'
          ? {
              turnId,
              fileCount: 1,
              additions: 2,
              deletions: 1,
              files: [
                {
                  path: '/workspace/src/app.ts',
                  displayPath: 'src/app.ts',
                  additions: 2,
                  deletions: 1,
                },
              ],
            }
          : undefined,
    });

    const assistant = messages.find((message) => message.role === 'assistant');
    expect(assistant).toMatchObject({
      role: 'assistant',
      changesReviews: [
        {
          turnId: 'turn-1',
          fileCount: 1,
          additions: 2,
          deletions: 1,
        },
      ],
    });
  });
});

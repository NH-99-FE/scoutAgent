// ============================================================
// Composer Atomic Reference Deletion — 相邻引用的原子删除语义
// ============================================================

import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  type LexicalNode,
} from 'lexical';
import {
  $isComposerReferenceNode,
  type ComposerReferenceNode,
} from '../model/composer-reference-node';

export function ComposerAtomicReferenceDeletionPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const removeAdjacentReference = (
      event: globalThis.KeyboardEvent | null,
      direction: 'backward' | 'forward',
    ) => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
      const reference = getAdjacentReference(
        selection.anchor.getNode(),
        selection.anchor.offset,
        direction,
      );
      if (!reference) return false;
      event?.preventDefault();
      reference.remove();
      return true;
    };

    const unregisterBackward = editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      (event) => removeAdjacentReference(event, 'backward'),
      COMMAND_PRIORITY_HIGH,
    );
    const unregisterForward = editor.registerCommand(
      KEY_DELETE_COMMAND,
      (event) => removeAdjacentReference(event, 'forward'),
      COMMAND_PRIORITY_HIGH,
    );
    return () => {
      unregisterBackward();
      unregisterForward();
    };
  }, [editor]);

  return null;
}

function getAdjacentReference(
  node: LexicalNode,
  offset: number,
  direction: 'backward' | 'forward',
): ComposerReferenceNode | null {
  if ($isTextNode(node)) {
    const atBoundary =
      direction === 'backward' ? offset === 0 : offset === node.getTextContentSize();
    if (!atBoundary) return null;
    const sibling = direction === 'backward' ? node.getPreviousSibling() : node.getNextSibling();
    return getEdgeReference(sibling, direction);
  }
  if ($isElementNode(node)) {
    const index = direction === 'backward' ? offset - 1 : offset;
    return getEdgeReference(node.getChildAtIndex(index), direction);
  }
  return null;
}

function getEdgeReference(
  node: LexicalNode | null,
  direction: 'backward' | 'forward',
): ComposerReferenceNode | null {
  if ($isComposerReferenceNode(node)) return node;
  if (!$isElementNode(node)) return null;
  const edgeChild = direction === 'backward' ? node.getLastChild() : node.getFirstChild();
  return getEdgeReference(edgeChild, direction);
}

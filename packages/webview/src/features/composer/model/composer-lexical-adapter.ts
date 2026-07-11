// ============================================================
// Composer Lexical Adapter — Lexical 树与框架无关文档之间的转换
// ============================================================

import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  type ElementNode,
  type LexicalNode,
} from 'lexical';
import {
  normalizeComposerDocument,
  type ComposerDocument,
  type ComposerSegment,
} from '@/store/composer-document';
import { $createComposerReferenceNode, $isComposerReferenceNode } from './composer-reference-node';

export function $readComposerDocument(): ComposerDocument {
  const segments: ComposerSegment[] = [];
  $getRoot()
    .getChildren()
    .forEach((node, index) => {
      if (index > 0) appendTextSegment(segments, '\n');
      visitNode(node, segments);
    });
  return normalizeComposerDocument({ segments });
}

export function $writeComposerDocument(document: ComposerDocument): void {
  const root = $getRoot();
  root.clear();
  const paragraph = $createParagraphNode();
  root.append(paragraph);
  for (const segment of document.segments) {
    if (segment.type === 'reference') {
      paragraph.append($createComposerReferenceNode(segment.reference));
    } else {
      appendLexicalText(paragraph, segment.text);
    }
  }
}

export function $getComposerSelectionOffset(): number | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const anchor = selection.anchor;
  const node = anchor.getNode();
  const paragraph = getTopLevelElement(node);
  if (!paragraph) return null;
  let offset = 0;
  for (const child of paragraph.getChildren()) {
    if (child.is(node)) {
      if ($isTextNode(child)) offset += Math.min(anchor.offset, child.getTextContentSize());
      return offset;
    }
    if (paragraph.is(node) && paragraph.getChildAtIndex(anchor.offset)?.is(child)) return offset;
    offset += getNodeLinearSize(child);
  }
  return offset;
}

export function $selectComposerOffset(targetOffset: number): void {
  const paragraph = $getRoot().getFirstChild();
  if (!$isElementNode(paragraph)) return;
  const boundedOffset = Math.max(0, targetOffset);
  let offset = 0;
  const children = paragraph.getChildren();
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if ($isTextNode(child)) {
      const size = child.getTextContentSize();
      if (boundedOffset <= offset + size) {
        const textOffset = Math.max(0, Math.min(boundedOffset - offset, size));
        child.select(textOffset, textOffset);
        return;
      }
      offset += size;
      continue;
    }
    const size = getNodeLinearSize(child);
    if (boundedOffset <= offset) {
      paragraph.select(index, index);
      return;
    }
    if (boundedOffset <= offset + size) {
      paragraph.select(index + 1, index + 1);
      return;
    }
    offset += size;
  }
  paragraph.selectEnd();
}

function visitNode(node: LexicalNode, segments: ComposerSegment[]): void {
  if ($isComposerReferenceNode(node)) {
    segments.push({ reference: node.getReference(), type: 'reference' });
    return;
  }
  if ($isTextNode(node)) {
    appendTextSegment(segments, node.getTextContent());
    return;
  }
  if ($isLineBreakNode(node)) {
    appendTextSegment(segments, '\n');
    return;
  }
  if ($isElementNode(node)) {
    node.getChildren().forEach((child) => visitNode(child, segments));
  }
}

function appendTextSegment(segments: ComposerSegment[], text: string): void {
  if (!text) return;
  const previous = segments.at(-1);
  if (previous?.type === 'text') previous.text += text;
  else segments.push({ text, type: 'text' });
}

function appendLexicalText(parent: ElementNode, text: string): void {
  text.split('\n').forEach((line, index) => {
    if (index > 0) parent.append($createLineBreakNode());
    if (line) parent.append($createTextNode(line));
  });
}

function getTopLevelElement(node: LexicalNode): ElementNode | null {
  let current: LexicalNode | null = node;
  while (current) {
    const parent: ElementNode | null = current.getParent();
    if (parent?.is($getRoot())) return $isElementNode(current) ? current : parent;
    current = parent;
  }
  return null;
}

function getNodeLinearSize(node: LexicalNode): number {
  if ($isComposerReferenceNode(node) || $isLineBreakNode(node)) return 1;
  return node.getTextContentSize();
}

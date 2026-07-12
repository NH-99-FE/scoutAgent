// ============================================================
// Composer Reference Node — Lexical 原子引用节点
// ============================================================

import type { JSX } from 'react';
import {
  $applyNodeReplacement,
  DecoratorNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import type { ComposerReference } from '@/store/composer-document';
import { ComposerInlineReference } from '../view/ComposerInlineReference';
import { formatComposerReference } from './composer-reference-format';

export type SerializedComposerReferenceNode = Spread<
  {
    reference: ComposerReference;
    type: 'composer-reference';
    version: 1;
  },
  SerializedLexicalNode
>;

export class ComposerReferenceNode extends DecoratorNode<JSX.Element> {
  __reference: ComposerReference;

  static getType(): string {
    return 'composer-reference';
  }

  static clone(node: ComposerReferenceNode): ComposerReferenceNode {
    return new ComposerReferenceNode(node.__reference, node.__key);
  }

  static importJSON(serializedNode: SerializedComposerReferenceNode): ComposerReferenceNode {
    return $createComposerReferenceNode(serializedNode.reference);
  }

  constructor(reference: ComposerReference, key?: NodeKey) {
    super(key);
    this.__reference = reference;
  }

  exportJSON(): SerializedComposerReferenceNode {
    return {
      ...super.exportJSON(),
      reference: this.__reference,
      type: 'composer-reference',
      version: 1,
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement('span');
    // DecoratorNode 会额外生成一层宿主元素；显式对齐行盒底部，避免图标成为基线来源。
    element.className = 'inline-block align-bottom leading-[inherit]';
    return element;
  }

  updateDOM(): false {
    return false;
  }

  decorate(): JSX.Element {
    return <ComposerInlineReference reference={this.__reference} />;
  }

  getTextContent(): string {
    return formatComposerReference(this.__reference);
  }

  isInline(): true {
    return true;
  }

  isIsolated(): true {
    return true;
  }

  isKeyboardSelectable(): true {
    return true;
  }

  getReference(): ComposerReference {
    return { ...this.getLatest().__reference };
  }
}

export function $createComposerReferenceNode(reference: ComposerReference): ComposerReferenceNode {
  return $applyNodeReplacement(new ComposerReferenceNode(reference));
}

export function $isComposerReferenceNode(
  node: LexicalNode | null | undefined,
): node is ComposerReferenceNode {
  return node instanceof ComposerReferenceNode;
}

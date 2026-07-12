// ============================================================
// Composer Document — 框架无关的输入文档契约与纯操作
// ============================================================

import type { ScoutFileMentionKind } from '@scout-agent/shared';

interface ComposerReferenceBase {
  id: string;
}

export interface ComposerSkillReference extends ComposerReferenceBase {
  commandName: string;
  kind: 'skill';
}

export interface ComposerFileReference extends ComposerReferenceBase {
  fileKind: ScoutFileMentionKind;
  kind: 'file';
  label: string;
  path: string;
}

export type ComposerReference = ComposerFileReference | ComposerSkillReference;

export interface ComposerTextSegment {
  text: string;
  type: 'text';
}

export interface ComposerReferenceSegment {
  reference: ComposerReference;
  type: 'reference';
}

export type ComposerSegment = ComposerReferenceSegment | ComposerTextSegment;

export interface ComposerDocument {
  segments: ComposerSegment[];
}

export interface ComposerTextRange {
  end: number;
  start: number;
}

export interface ComposerReferenceInsertion {
  document: ComposerDocument;
  selectionOffset: number;
}

export const COMPOSER_REFERENCE_CHARACTER = '\uFFFC';
export const EMPTY_COMPOSER_DOCUMENT: ComposerDocument = { segments: [] };

export function createComposerTextDocument(text: string): ComposerDocument {
  return text ? { segments: [{ text, type: 'text' }] } : EMPTY_COMPOSER_DOCUMENT;
}

export function normalizeComposerDocument(document: ComposerDocument): ComposerDocument {
  const segments: ComposerSegment[] = [];
  for (const segment of document.segments) {
    if (segment.type === 'text') {
      if (!segment.text) continue;
      const previous = segments.at(-1);
      if (previous?.type === 'text') {
        previous.text += segment.text;
      } else {
        segments.push({ ...segment });
      }
      continue;
    }
    segments.push({ reference: { ...segment.reference }, type: 'reference' });
  }
  return segments.length === 0 ? EMPTY_COMPOSER_DOCUMENT : { segments };
}

export function getComposerLinearText(document: ComposerDocument): string {
  return document.segments
    .map((segment) => (segment.type === 'text' ? segment.text : COMPOSER_REFERENCE_CHARACTER))
    .join('');
}

export function getComposerPlainText(document: ComposerDocument): string {
  return document.segments
    .filter((segment): segment is ComposerTextSegment => segment.type === 'text')
    .map((segment) => segment.text)
    .join('');
}

export function hasComposerReferences(document: ComposerDocument): boolean {
  return document.segments.some((segment) => segment.type === 'reference');
}

export function isComposerDocumentEmpty(document: ComposerDocument): boolean {
  return document.segments.length === 0;
}

export function areComposerDocumentsEqual(
  left: ComposerDocument,
  right: ComposerDocument,
): boolean {
  if (left === right) return true;
  if (left.segments.length !== right.segments.length) return false;
  return left.segments.every((segment, index) => {
    const candidate = right.segments[index];
    if (!candidate || segment.type !== candidate.type) return false;
    if (segment.type === 'text' && candidate.type === 'text') {
      return segment.text === candidate.text;
    }
    if (segment.type === 'reference' && candidate.type === 'reference') {
      return areComposerReferencesEqual(segment.reference, candidate.reference);
    }
    return false;
  });
}

export function replaceComposerRange(
  document: ComposerDocument,
  range: ComposerTextRange,
  replacementText: string,
  reference?: ComposerReference,
): ComposerDocument {
  const documentLength = getComposerDocumentLength(document);
  const start = Math.max(0, Math.min(range.start, documentLength));
  const end = Math.max(start, Math.min(range.end, documentLength));
  const prefix = sliceComposerSegments(document, 0, start);
  const suffix = sliceComposerSegments(document, end, documentLength);
  const nextPrefix = reference?.kind === 'skill' ? removeSkillReferences(prefix) : prefix;
  const nextSuffix = reference?.kind === 'skill' ? removeSkillReferences(suffix) : suffix;
  const segments = [
    ...nextPrefix,
    ...(reference ? [{ reference, type: 'reference' as const }] : []),
    ...(replacementText ? [{ text: replacementText, type: 'text' as const }] : []),
    ...nextSuffix,
  ];
  return normalizeComposerDocument({ segments });
}

export function insertComposerReferenceAt(
  document: ComposerDocument,
  offset: number,
  reference: ComposerReference,
): ComposerReferenceInsertion {
  const linearText = getComposerLinearText(document);
  const anchor = Math.max(0, Math.min(offset, linearText.length));
  const previousCharacter = linearText[anchor - 1];
  const nextCharacter = linearText[anchor];
  const leadingSpace = previousCharacter !== undefined && !/\s/u.test(previousCharacter) ? ' ' : '';
  const trailingSpace = nextCharacter === undefined || !/\s/u.test(nextCharacter) ? ' ' : '';
  const documentWithLeadingSpace = replaceComposerRange(
    document,
    { start: anchor, end: anchor },
    leadingSpace,
  );
  const referenceOffset = anchor + leadingSpace.length;
  return {
    document: replaceComposerRange(
      documentWithLeadingSpace,
      { start: referenceOffset, end: referenceOffset },
      trailingSpace,
      reference,
    ),
    selectionOffset: referenceOffset + 1 + trailingSpace.length,
  };
}

export function insertComposerReferencesAt(
  document: ComposerDocument,
  offset: number,
  references: ComposerReference[],
): ComposerReferenceInsertion {
  let nextDocument = document;
  let selectionOffset = Math.max(0, Math.min(offset, getComposerDocumentLength(document)));
  for (const reference of references) {
    const insertion = insertComposerReferenceAt(nextDocument, selectionOffset, reference);
    nextDocument = insertion.document;
    selectionOffset = insertion.selectionOffset;
  }
  return { document: nextDocument, selectionOffset };
}

export function replaceComposerRangeWithReferences(
  document: ComposerDocument,
  range: ComposerTextRange,
  references: ComposerReference[],
): ComposerReferenceInsertion {
  const documentLength = getComposerDocumentLength(document);
  const start = Math.max(0, Math.min(range.start, documentLength));
  const withoutRange = replaceComposerRange(document, range, '');
  return insertComposerReferencesAt(withoutRange, start, references);
}

function removeSkillReferences(segments: ComposerSegment[]): ComposerSegment[] {
  return segments.filter(
    (segment) => segment.type !== 'reference' || segment.reference.kind !== 'skill',
  );
}

export function cloneComposerDocument(document: ComposerDocument): ComposerDocument {
  return normalizeComposerDocument(document);
}

function getComposerDocumentLength(document: ComposerDocument): number {
  return document.segments.reduce(
    (length, segment) => length + (segment.type === 'text' ? segment.text.length : 1),
    0,
  );
}

function sliceComposerSegments(
  document: ComposerDocument,
  start: number,
  end: number,
): ComposerSegment[] {
  if (start >= end) return [];
  const segments: ComposerSegment[] = [];
  let cursor = 0;
  for (const segment of document.segments) {
    const size = segment.type === 'text' ? segment.text.length : 1;
    const segmentEnd = cursor + size;
    if (segmentEnd <= start) {
      cursor = segmentEnd;
      continue;
    }
    if (cursor >= end) break;
    if (segment.type === 'reference') {
      segments.push({ reference: { ...segment.reference }, type: 'reference' });
    } else {
      const sliceStart = Math.max(0, start - cursor);
      const sliceEnd = Math.min(size, end - cursor);
      const text = segment.text.slice(sliceStart, sliceEnd);
      if (text) segments.push({ text, type: 'text' });
    }
    cursor = segmentEnd;
  }
  return segments;
}

function areComposerReferencesEqual(left: ComposerReference, right: ComposerReference): boolean {
  if (left.kind !== right.kind || left.id !== right.id) return false;
  if (left.kind === 'skill' && right.kind === 'skill') {
    return left.commandName === right.commandName;
  }
  if (left.kind === 'file' && right.kind === 'file') {
    return (
      left.fileKind === right.fileKind && left.label === right.label && left.path === right.path
    );
  }
  return false;
}

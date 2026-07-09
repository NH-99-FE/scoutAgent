// ============================================================
// Composer Images — 输入区图片策略与协议适配
// ============================================================

import type { ScoutImageContent } from '@scout-agent/shared';
import {
  getComposerImageFile,
  getComposerImageObjectUrl,
  type ComposerImageDescriptor,
} from '@/store/composer-image-registry';

export const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);
export const SUPPORTED_IMAGE_INPUT_ACCEPT = Array.from(SUPPORTED_IMAGE_MIME_TYPES).join(',');
export const MAX_COMPOSER_IMAGE_COUNT = 6;
export const MAX_COMPOSER_IMAGE_BYTES = 2 * 1024 * 1024;

export interface AcceptedComposerImageFile {
  file: File;
  mimeType: string;
}

interface ComposerImageSelection {
  acceptedFiles: AcceptedComposerImageFile[];
  warningMessages: string[];
}

const IMAGE_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function normalizeComposerImageMimeType(mimeType: string): string {
  return mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
}

export function isSupportedImageFile(file: File): boolean {
  return SUPPORTED_IMAGE_MIME_TYPES.has(normalizeComposerImageMimeType(file.type));
}

export function getClipboardImageFiles(clipboardData: DataTransfer): File[] {
  const itemFiles = Array.from(clipboardData.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
  if (itemFiles.length > 0) return itemFiles;
  return Array.from(clipboardData.files);
}

export async function selectComposerImageFiles(
  files: File[],
  existingImageCount: number,
): Promise<ComposerImageSelection> {
  const warningMessages: string[] = [];
  const acceptedFiles: AcceptedComposerImageFile[] = [];
  const availableSlots = Math.max(0, MAX_COMPOSER_IMAGE_COUNT - existingImageCount);
  let unsupportedCount = 0;
  let oversizedCount = 0;
  let animatedCount = 0;
  let overflowCount = 0;

  for (const file of files) {
    const mimeType = normalizeComposerImageMimeType(file.type);
    if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
      unsupportedCount += 1;
      continue;
    }
    if (file.size > MAX_COMPOSER_IMAGE_BYTES) {
      oversizedCount += 1;
      continue;
    }
    if (acceptedFiles.length >= availableSlots) {
      overflowCount += 1;
      continue;
    }
    if (await isAnimatedImageFile(file, mimeType)) {
      animatedCount += 1;
      continue;
    }
    acceptedFiles.push({ file, mimeType });
  }

  if (unsupportedCount > 0) {
    warningMessages.push(
      unsupportedCount === 1
        ? '已忽略 1 个不支持的图片文件'
        : `已忽略 ${unsupportedCount} 个不支持的图片文件`,
    );
  }
  if (oversizedCount > 0) {
    warningMessages.push(
      oversizedCount === 1
        ? '已忽略 1 张超过 2MB 的图片'
        : `已忽略 ${oversizedCount} 张超过 2MB 的图片`,
    );
  }
  if (animatedCount > 0) {
    warningMessages.push(
      animatedCount === 1
        ? '已忽略 1 张动画图片，暂不支持发送动画'
        : `已忽略 ${animatedCount} 张动画图片，暂不支持发送动画`,
    );
  }

  if (overflowCount > 0) {
    warningMessages.push(`最多只能添加 ${MAX_COMPOSER_IMAGE_COUNT} 张图片`);
  }

  return { acceptedFiles, warningMessages };
}

export function toImageSource(image: ComposerImageDescriptor): string {
  return getComposerImageObjectUrl(image) ?? '';
}

export function getImageDownloadName(image: ComposerImageDescriptor, index: number): string {
  if (image.name) return image.name;
  const extension = IMAGE_EXTENSION_BY_MIME_TYPE[image.mimeType] ?? 'png';
  return `scout-image-${index + 1}.${extension}`;
}

export async function encodeComposerImageAttachments(
  images: ComposerImageDescriptor[],
): Promise<ScoutImageContent[]> {
  if (images.length === 0) return [];
  const settledImages = await Promise.allSettled(images.map(encodeComposerImageAttachment));
  const failedCount = settledImages.filter((result) => result.status === 'rejected').length;
  if (failedCount > 0) {
    throw new ComposerImageEncodeError(failedCount);
  }
  return settledImages.map((result) => {
    return (result as PromiseFulfilledResult<ScoutImageContent>).value;
  });
}

export class ComposerImageEncodeError extends Error {
  readonly failedCount: number;

  constructor(failedCount: number) {
    super(
      failedCount === 1 ? '图片读取失败，请重新选择' : `${failedCount} 张图片读取失败，请重新选择`,
    );
    this.failedCount = failedCount;
    this.name = 'ComposerImageEncodeError';
  }
}

async function isAnimatedImageFile(file: File, mimeType: string): Promise<boolean> {
  if (mimeType !== 'image/gif' && mimeType !== 'image/webp') return false;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (mimeType === 'image/gif') return isAnimatedGif(bytes);
  return isAnimatedWebp(bytes);
}

function isAnimatedGif(bytes: Uint8Array): boolean {
  if (bytes.length < 13 || readAscii(bytes, 0, 6).slice(0, 3) !== 'GIF') return false;
  let offset = 13;
  const packed = bytes[10] ?? 0;
  if ((packed & 0x80) !== 0) {
    offset += 3 * 2 ** ((packed & 0x07) + 1);
  }

  let imageCount = 0;
  while (offset < bytes.length) {
    const blockType = bytes[offset];
    offset += 1;
    if (blockType === 0x2c) {
      imageCount += 1;
      if (imageCount > 1) return true;
      if (offset + 9 > bytes.length) return false;
      const imagePacked = bytes[offset + 8] ?? 0;
      offset += 9;
      if ((imagePacked & 0x80) !== 0) {
        offset += 3 * 2 ** ((imagePacked & 0x07) + 1);
      }
      offset += 1;
      offset = skipGifSubBlocks(bytes, offset);
      continue;
    }
    if (blockType === 0x21) {
      offset += 1;
      offset = skipGifSubBlocks(bytes, offset);
      continue;
    }
    if (blockType === 0x3b) return false;
    return false;
  }
  return false;
}

function skipGifSubBlocks(bytes: Uint8Array, offset: number): number {
  while (offset < bytes.length) {
    const size = bytes[offset] ?? 0;
    offset += 1;
    if (size === 0) return offset;
    offset += size;
  }
  return bytes.length;
}

function isAnimatedWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  if (readAscii(bytes, 0, 4) !== 'RIFF' || readAscii(bytes, 8, 4) !== 'WEBP') return false;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkType = readAscii(bytes, offset, 4);
    const chunkSize = readUint32LittleEndian(bytes, offset + 4);
    const dataOffset = offset + 8;
    if (chunkType === 'VP8X' && dataOffset < bytes.length) {
      return ((bytes[dataOffset] ?? 0) & 0x02) !== 0;
    }
    if (chunkType === 'ANIM' || chunkType === 'ANMF') return true;
    offset = dataOffset + chunkSize + (chunkSize % 2);
  }
  return false;
}

function encodeComposerImageAttachment(image: ComposerImageDescriptor): Promise<ScoutImageContent> {
  return new Promise((resolve, reject) => {
    const file = getComposerImageFile(image);
    if (!file) {
      reject(new Error(`图片资源已释放: ${image.id}`));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const [, data = ''] = result.split(',', 2);
      resolve({
        type: 'image',
        data,
        mimeType: image.mimeType,
      });
    };
    reader.readAsDataURL(file);
  });
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function readUint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

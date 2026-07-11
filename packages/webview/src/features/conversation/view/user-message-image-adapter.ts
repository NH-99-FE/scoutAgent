// ============================================================
// User Message Image Adapter — 历史用户图片到预览展示项的局部适配
// ============================================================

import { SCOUT_IMAGE_EXTENSION_BY_MIME_TYPE, type ScoutImageContent } from '@scout-agent/shared';
import type { ImagePreviewItem } from '@/components/common/ImagePreviewDialog';

export interface UserMessageImagePreviewItem extends ImagePreviewItem {
  key: string;
  thumbnailAlt: string;
  previewButtonLabel: string;
}

/**
 * 历史消息没有 composer 的 File 元数据；在此集中生成预览所需的数据 URL、稳定展示文案与下载文件名。
 */
export function adaptUserMessageImagePreviewItems(
  images: ScoutImageContent[],
): UserMessageImagePreviewItem[] {
  return images.map((image, index) => ({
    key: `${image.mimeType}:${image.data.slice(0, 24)}:${index}`,
    source: toUserMessageImageSource(image),
    downloadName: `scout-image-${index + 1}.${SCOUT_IMAGE_EXTENSION_BY_MIME_TYPE[image.mimeType] ?? 'png'}`,
    thumbnailAlt: `已发送图片 ${index + 1}`,
    previewButtonLabel: `预览已发送图片 ${index + 1}`,
  }));
}

function toUserMessageImageSource(image: ScoutImageContent): string {
  if (image.data.startsWith('data:')) return image.data;
  return `data:${image.mimeType};base64,${image.data}`;
}

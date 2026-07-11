// ============================================================
// Composer Image Preview Dialog — 待发送图片预览适配
// ============================================================

import { ImagePreviewDialog } from '@/components/common/ImagePreviewDialog';
import { protocolClient } from '@/bridge/protocol-client';
import type { ComposerImageDescriptor } from '@/store/composer-store';
import { useUiActions } from '@/store/ui-store';
import {
  encodeComposerImageAttachment,
  getImageDownloadName,
  toImageSource,
} from '../model/composer-images';

interface ComposerImagePreviewDialogProps {
  images: ComposerImageDescriptor[];
  imageIndex: number;
  onImageIndexChange: (index: number) => void;
  onClose: () => void;
}

export function ComposerImagePreviewDialog({
  images,
  imageIndex,
  onImageIndexChange,
  onClose,
}: ComposerImagePreviewDialogProps) {
  const uiActions = useUiActions();

  const downloadImage = (index: number) => {
    const image = images[index];
    if (!image) return;

    void encodeComposerImageAttachment(image)
      .then((content) => {
        protocolClient.downloadImage(content, getImageDownloadName(image, index));
      })
      .catch((error: unknown) => {
        uiActions.setNotification({
          type: 'notification',
          level: 'error',
          message: error instanceof Error ? error.message : '图片读取失败，无法下载',
        });
      });
  };

  return (
    <ImagePreviewDialog
      imageIndex={imageIndex}
      images={images.map((image, index) => ({
        source: toImageSource(image),
        downloadName: getImageDownloadName(image, index),
      }))}
      onClose={onClose}
      onDownload={downloadImage}
      onImageIndexChange={onImageIndexChange}
    />
  );
}

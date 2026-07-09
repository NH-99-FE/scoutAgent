// ============================================================
// Composer Image Preview Dialog — 待发送图片预览
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { Download, Minus, Plus, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { markProgrammaticFocus } from '@/components/ui/focus';
import type { ComposerImageDescriptor } from '@/store/composer-store';
import { getImageDownloadName, toImageSource } from '../model/composer-images';

const IMAGE_PREVIEW_MIN_ZOOM = 0.5;
const IMAGE_PREVIEW_MAX_ZOOM = 3;
const IMAGE_PREVIEW_ZOOM_STEP = 0.25;

interface ComposerImagePreviewDialogProps {
  image: ComposerImageDescriptor;
  imageIndex: number;
  onClose: () => void;
}

export function ComposerImagePreviewDialog({
  image,
  imageIndex,
  onClose,
}: ComposerImagePreviewDialogProps) {
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const source = toImageSource(image);
  const zoomPercent = Math.round(zoom * 100);

  useEffect(() => {
    const returnFocusTarget = returnFocusRef.current;
    return () => {
      if (!returnFocusTarget?.isConnected) return;
      markProgrammaticFocus(returnFocusTarget);
      returnFocusTarget.focus();
    };
  }, []);

  const zoomPreviewBy = (delta: number) => {
    setZoom((current) => clampImagePreviewZoom(current + delta));
  };

  return (
    <Dialog open onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        className="bg-overlay-background text-foreground fixed inset-0 top-0 left-0 z-[100] h-dvh w-dvw max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none p-0 shadow-none ring-0 backdrop-brightness-50 supports-backdrop-filter:backdrop-blur-xs sm:max-w-none"
        showCloseButton={false}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          closeButtonRef.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">图片预览</DialogTitle>
        <DialogDescription className="sr-only">预览待发送图片</DialogDescription>

        <div
          className="absolute top-4 right-4 z-10 flex items-center gap-3"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <a
            aria-label="下载图片"
            className="bg-background/80 text-foreground hover:bg-background focus-visible:ring-ring/50 grid size-12 place-items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none"
            download={getImageDownloadName(image, imageIndex)}
            href={source}
          >
            <Download className="size-5" />
          </a>
          <button
            aria-label="关闭预览"
            ref={closeButtonRef}
            className="bg-background/80 text-foreground hover:bg-background focus-visible:ring-ring/50 grid size-12 place-items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none"
            type="button"
            onClick={onClose}
          >
            <X className="size-5" />
          </button>
        </div>

        <div
          className="absolute inset-0 flex min-h-0 min-w-0 items-center justify-center px-6 py-24"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <img
            alt="图片预览"
            className="max-h-full max-w-full rounded-xl object-contain shadow-2xl transition-transform duration-100"
            draggable={false}
            src={source}
            style={{ transform: `scale(${zoom})` }}
          />
        </div>

        <div
          className="bg-background/80 absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-4 rounded-full px-2 py-2 text-sm font-medium shadow-lg backdrop-blur"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            aria-label="缩小图片"
            className="text-foreground hover:bg-muted grid size-10 place-items-center rounded-full transition-colors disabled:opacity-40"
            disabled={zoom <= IMAGE_PREVIEW_MIN_ZOOM}
            type="button"
            onClick={() => zoomPreviewBy(-IMAGE_PREVIEW_ZOOM_STEP)}
          >
            <Minus className="size-4" />
          </button>
          <span className="w-14 text-center tabular-nums">{zoomPercent}%</span>
          <button
            aria-label="放大图片"
            className="text-foreground hover:bg-muted grid size-10 place-items-center rounded-full transition-colors disabled:opacity-40"
            disabled={zoom >= IMAGE_PREVIEW_MAX_ZOOM}
            type="button"
            onClick={() => zoomPreviewBy(IMAGE_PREVIEW_ZOOM_STEP)}
          >
            <Plus className="size-4" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function clampImagePreviewZoom(zoom: number): number {
  return Math.min(IMAGE_PREVIEW_MAX_ZOOM, Math.max(IMAGE_PREVIEW_MIN_ZOOM, zoom));
}

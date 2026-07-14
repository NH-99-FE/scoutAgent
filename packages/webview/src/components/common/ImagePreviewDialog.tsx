// ============================================================
// Image Preview Dialog — 通用全屏图片预览与同组切换
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Minus, Plus, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

const IMAGE_PREVIEW_MIN_ZOOM = 0.5;
const IMAGE_PREVIEW_MAX_ZOOM = 3;
const IMAGE_PREVIEW_ZOOM_STEP = 0.25;

export interface ImagePreviewItem {
  source: string;
  downloadName: string;
}

interface ImagePreviewDialogProps {
  images: ImagePreviewItem[];
  imageIndex: number;
  onDownload: (imageIndex: number) => void;
  onImageIndexChange: (index: number) => void;
  onClose: () => void;
}

export function ImagePreviewDialog({
  images,
  imageIndex,
  onDownload,
  onImageIndexChange,
  onClose,
}: ImagePreviewDialogProps) {
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const image = images[imageIndex];
  const zoomPercent = Math.round(zoom * 100);

  useEffect(() => {
    const returnFocusTarget = returnFocusRef.current;
    return () => {
      if (!returnFocusTarget?.isConnected) return;
      returnFocusTarget.focus();
    };
  }, []);

  if (!image) return null;

  const selectImage = (nextIndex: number) => {
    if (!images[nextIndex]) return;
    setZoom(1);
    onImageIndexChange(nextIndex);
  };

  const zoomPreviewBy = (delta: number) => {
    setZoom((current) => clampImagePreviewZoom(current + delta));
  };

  return (
    <Dialog open onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        className="bg-overlay-background text-foreground fixed inset-0 top-0 left-0 z-[100] h-dvh w-dvw max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none p-0 shadow-none ring-0 backdrop-brightness-50 supports-backdrop-filter:backdrop-blur-xs sm:max-w-none"
        showCloseButton={false}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' && imageIndex > 0) {
            event.preventDefault();
            selectImage(imageIndex - 1);
          }
          if (event.key === 'ArrowRight' && imageIndex < images.length - 1) {
            event.preventDefault();
            selectImage(imageIndex + 1);
          }
        }}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          closeButtonRef.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">图片预览</DialogTitle>
        <DialogDescription className="sr-only">
          正在预览第 {imageIndex + 1} 张图片，共 {images.length} 张
        </DialogDescription>

        <div
          className="absolute top-4 right-4 z-10 flex items-center gap-3"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            aria-label="下载图片"
            className="bg-background/80 text-foreground hover:bg-background focus-visible:ring-ring/50 grid size-10 place-items-center rounded-full transition-[color,transform] duration-150 ease-out focus-visible:ring-2 focus-visible:outline-none active:scale-90"
            type="button"
            onClick={() => onDownload(imageIndex)}
          >
            <Download className="size-3.5" />
          </button>
          <button
            aria-label="关闭预览"
            ref={closeButtonRef}
            className="bg-background/80 text-foreground hover:bg-background focus-visible:ring-ring/50 grid size-10 place-items-center rounded-full transition-[color,transform] duration-150 ease-out focus-visible:ring-2 focus-visible:outline-none active:scale-90"
            type="button"
            onClick={onClose}
          >
            <X className="size-3.5" />
          </button>
        </div>

        {imageIndex > 0 ? (
          <button
            aria-label="上一张图片"
            className="bg-background/80 text-foreground hover:bg-background focus-visible:ring-ring/50 absolute top-1/2 left-3 z-10 grid size-10 -translate-y-1/2 place-items-center rounded-full transition-[color,transform] duration-150 ease-out focus-visible:ring-2 focus-visible:outline-none active:scale-90"
            type="button"
            onClick={() => selectImage(imageIndex - 1)}
          >
            <ChevronLeft className="size-3.5" />
          </button>
        ) : null}

        {imageIndex < images.length - 1 ? (
          <button
            aria-label="下一张图片"
            className="bg-background/80 text-foreground hover:bg-background focus-visible:ring-ring/50 absolute top-1/2 right-3 z-10 grid size-10 -translate-y-1/2 place-items-center rounded-full transition-[color,transform] duration-150 ease-out focus-visible:ring-2 focus-visible:outline-none active:scale-90"
            type="button"
            onClick={() => selectImage(imageIndex + 1)}
          >
            <ChevronRight className="size-3.5" />
          </button>
        ) : null}

        <div
          className="absolute inset-0 flex min-h-0 min-w-0 items-center justify-center px-20 py-24"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <img
            alt="图片预览"
            className="max-h-full max-w-full rounded-xl object-contain shadow-2xl transition-transform duration-100"
            draggable={false}
            src={image.source}
            style={{ transform: `scale(${zoom})` }}
          />
        </div>

        <div
          className="border-border/60 bg-background/80 absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border px-1.5 py-1.5 text-sm font-medium shadow-xl backdrop-blur-md"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            aria-label="缩小图片"
            className="bg-muted/80 text-foreground hover:bg-muted focus-visible:ring-ring/50 grid size-10 place-items-center rounded-full transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
            disabled={zoom <= IMAGE_PREVIEW_MIN_ZOOM}
            type="button"
            onClick={() => zoomPreviewBy(-IMAGE_PREVIEW_ZOOM_STEP)}
          >
            <Minus className="size-3.5" />
          </button>
          <span className="w-12 text-center tabular-nums">{zoomPercent}%</span>
          <button
            aria-label="放大图片"
            className="bg-muted/80 text-foreground hover:bg-muted focus-visible:ring-ring/50 grid size-10 place-items-center rounded-full transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
            disabled={zoom >= IMAGE_PREVIEW_MAX_ZOOM}
            type="button"
            onClick={() => zoomPreviewBy(IMAGE_PREVIEW_ZOOM_STEP)}
          >
            <Plus className="size-3.5" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function clampImagePreviewZoom(zoom: number): number {
  return Math.min(IMAGE_PREVIEW_MAX_ZOOM, Math.max(IMAGE_PREVIEW_MIN_ZOOM, zoom));
}

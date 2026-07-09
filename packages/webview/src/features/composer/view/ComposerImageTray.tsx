// ============================================================
// Composer Image Tray — 待发送图片缩略图
// ============================================================

import { X } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ComposerImageDescriptor } from '@/store/composer-store';
import { toImageSource } from '../model/composer-images';

interface ComposerImageTrayProps {
  images: ComposerImageDescriptor[];
  removeDisabled?: boolean;
  onPreview: (index: number) => void;
  onRemove: (index: number) => void;
}

export function ComposerImageTray({
  images,
  removeDisabled = false,
  onPreview,
  onRemove,
}: ComposerImageTrayProps) {
  return (
    <ScrollArea
      className="mb-2 max-w-full min-w-0 [&_[data-slot=scroll-area-scrollbar]]:hidden"
      scrollbars="horizontal"
      viewportClassName="overflow-x-auto overflow-y-hidden"
    >
      <div className="flex w-max min-w-full flex-nowrap gap-2 px-1 pt-1 pb-1">
        {images.map((image, index) => {
          const source = toImageSource(image);
          return (
            <div className="group/image relative size-20 shrink-0" key={image.id}>
              <button
                aria-label={`预览图片 ${index + 1}`}
                className="border-border bg-muted focus-visible:border-ring focus-visible:ring-ring/40 block size-full cursor-pointer overflow-hidden rounded-xl border text-left transition-colors outline-none focus-visible:ring-2"
                type="button"
                onClick={() => onPreview(index)}
              >
                <img
                  alt={`待发送图片 ${index + 1}`}
                  className="size-full object-cover"
                  draggable={false}
                  src={source}
                />
              </button>
              <button
                aria-label={`移除图片 ${index + 1}`}
                className="bg-foreground text-background ring-border absolute top-1 right-1 grid size-[18px] cursor-pointer place-items-center rounded-full shadow-sm ring-1 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={removeDisabled}
                type="button"
                onClick={() => onRemove(index)}
              >
                <X className="size-2.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

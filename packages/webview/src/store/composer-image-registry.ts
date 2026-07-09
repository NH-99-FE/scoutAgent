// ============================================================
// Composer Image Registry — 输入区图片资源池
// ============================================================

export interface ComposerImageDescriptor {
  id: string;
  mimeType: string;
  name: string;
  size: number;
  type: 'image';
}

interface ComposerImageAsset {
  file: File;
  objectUrl: string;
  refCount: number;
}

export interface ComposerImageLease {
  readonly images: readonly ComposerImageDescriptor[];
  release: () => void;
  transfer: () => ComposerImageDescriptor[];
}

const composerImageAssets = new Map<string, ComposerImageAsset>();
let nextFallbackImageId = 0;

export function registerComposerImageFile(
  file: File,
  mimeType = file.type,
): ComposerImageDescriptor {
  const id = createComposerImageId();
  composerImageAssets.set(id, {
    file,
    objectUrl: createImageObjectUrl(file),
    refCount: 1,
  });
  return {
    id,
    mimeType,
    name: file.name,
    size: file.size,
    type: 'image',
  };
}

export function retainComposerImageDescriptors(
  images: readonly ComposerImageDescriptor[] | undefined,
): void {
  if (!images) return;
  for (const image of images) {
    const asset = composerImageAssets.get(image.id);
    if (asset) {
      asset.refCount += 1;
    }
  }
}

export function releaseComposerImageDescriptors(
  images: readonly ComposerImageDescriptor[] | undefined,
): void {
  if (!images) return;
  for (const image of images) {
    releaseComposerImageDescriptor(image);
  }
}

export function retainComposerImageLease(
  images: readonly ComposerImageDescriptor[] | undefined,
): ComposerImageLease | null {
  if (!images || images.length === 0) return null;
  retainComposerImageDescriptors(images);
  return new RetainedComposerImageLease(images);
}

export function getComposerImageFile(image: ComposerImageDescriptor): File | undefined {
  return composerImageAssets.get(image.id)?.file;
}

export function getComposerImageObjectUrl(image: ComposerImageDescriptor): string | undefined {
  return composerImageAssets.get(image.id)?.objectUrl;
}

export function resetComposerImageRegistry(): void {
  for (const asset of composerImageAssets.values()) {
    revokeImageObjectUrl(asset.objectUrl);
  }
  composerImageAssets.clear();
}

function releaseComposerImageDescriptor(image: ComposerImageDescriptor): void {
  const asset = composerImageAssets.get(image.id);
  if (!asset) return;
  asset.refCount -= 1;
  if (asset.refCount > 0) return;
  revokeImageObjectUrl(asset.objectUrl);
  composerImageAssets.delete(image.id);
}

class RetainedComposerImageLease implements ComposerImageLease {
  readonly images: readonly ComposerImageDescriptor[];
  private released = false;

  constructor(images: readonly ComposerImageDescriptor[]) {
    this.images = [...images];
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    releaseComposerImageDescriptors(this.images);
  }

  transfer(): ComposerImageDescriptor[] {
    if (this.released) return [];
    this.released = true;
    return [...this.images];
  }
}

function createComposerImageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  nextFallbackImageId += 1;
  return `composer-image-${nextFallbackImageId}`;
}

function createImageObjectUrl(file: File): string {
  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    return URL.createObjectURL(file);
  }
  return '';
}

function revokeImageObjectUrl(objectUrl: string): void {
  if (!objectUrl) return;
  if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return;
  URL.revokeObjectURL(objectUrl);
}

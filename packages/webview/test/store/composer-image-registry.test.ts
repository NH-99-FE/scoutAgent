import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  registerComposerImageFile,
  releaseComposerImageDescriptors,
  resetComposerImageRegistry,
  retainComposerImageLease,
} from '@/store/composer-image-registry';

const createObjectUrl = vi.fn((file: File) => `blob:${file.name}`);
const revokeObjectUrl = vi.fn();

describe('composer-image-registry', () => {
  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectUrl,
    });
    resetComposerImageRegistry();
    createObjectUrl.mockClear();
    revokeObjectUrl.mockClear();
  });

  afterEach(() => {
    resetComposerImageRegistry();
    vi.restoreAllMocks();
  });

  it('keeps image assets alive until a retained lease is released', () => {
    const image = registerComposerImageFile(
      new File(['image'], 'leased.png', { type: 'image/png' }),
    );
    const lease = retainComposerImageLease([image]);

    releaseComposerImageDescriptors([image]);
    expect(revokeObjectUrl).not.toHaveBeenCalled();

    lease?.release();
    lease?.release();

    expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:leased.png');
  });

  it('transfers a retained lease to the next image owner', () => {
    const image = registerComposerImageFile(
      new File(['image'], 'transferred.png', { type: 'image/png' }),
    );
    const lease = retainComposerImageLease([image]);

    releaseComposerImageDescriptors([image]);
    const transferredImages = lease?.transfer() ?? [];
    lease?.release();

    expect(transferredImages).toEqual([image]);
    expect(revokeObjectUrl).not.toHaveBeenCalled();

    releaseComposerImageDescriptors(transferredImages);

    expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:transferred.png');
  });
});

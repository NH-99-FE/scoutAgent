import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getComposerImageFile,
  registerComposerImageFile,
  releaseComposerImageDescriptors,
  resetComposerImageRegistry,
  retainComposerImageLease,
} from '@/store/composer-image-registry';
import { useComposerStore } from '@/store/composer-store';

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
    useComposerStore.getState().actions.reset();
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

  it('keeps a failed draft image alive until the recoverable draft is handled', () => {
    const image = registerComposerImageFile(
      new File(['image'], 'recoverable.png', { type: 'image/png' }),
    );
    const actions = useComposerStore.getState().actions;
    actions.addImages('session-1', [image]);
    actions.stagePendingDraft(
      'session-1',
      {
        document: { segments: [{ type: 'text', text: 'failed message' }] },
        images: [image],
      },
      'request-1',
    );
    actions.clearDraft('session-1');
    actions.setText('session-1', 'newer draft');

    actions.restorePendingDraft('session-1', 'request-1');

    expect(getComposerImageFile(image)).toBeDefined();
    expect(revokeObjectUrl).not.toHaveBeenCalled();

    actions.discardFailedDraft('session-1', 'request-1');

    expect(getComposerImageFile(image)).toBeUndefined();
    expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:recoverable.png');
  });
});

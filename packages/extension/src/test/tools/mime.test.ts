// ============================================================
// MIME 检测测试
// ============================================================

import { describe, expect, it } from 'vitest';
import { detectSupportedImageMimeType } from '../../tools/shared/mime.ts';

describe('detectSupportedImageMimeType', () => {
  it('detects PNG from file magic bytes', () => {
    const png1x1 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==',
      'base64',
    );

    expect(detectSupportedImageMimeType(png1x1)).toBe('image/png');
  });

  it('does not detect image type from extension-like text', () => {
    expect(detectSupportedImageMimeType(Buffer.from('not-an-image.png'))).toBeNull();
  });

  it('detects JPEG, GIF, and WEBP signatures', () => {
    expect(detectSupportedImageMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectSupportedImageMimeType(Buffer.from('GIF89a', 'ascii'))).toBe('image/gif');
    expect(
      detectSupportedImageMimeType(
        Buffer.concat([Buffer.from('RIFFxxxxWEBP', 'ascii'), Buffer.alloc(8)]),
      ),
    ).toBe('image/webp');
  });
});

import { describe, it, expect } from 'vitest';
import { detectImageSignature } from '@/src/modules/uploads/validation';

describe('Image Magic Bytes Signature Detection', () => {
  it('correctly detects JPEG signature (FF D8 FF)', () => {
    const jpegBuffer = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    ]);
    expect(detectImageSignature(jpegBuffer)).toBe('image/jpeg');
  });

  it('correctly detects PNG signature (89 50 4E 47 0D 0A 1A 0A)', () => {
    const pngBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);
    expect(detectImageSignature(pngBuffer)).toBe('image/png');
  });

  it('correctly detects WebP signature (RIFF....WEBP)', () => {
    const webpBuffer = Buffer.from([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x24, 0x00, 0x00, 0x00, // Size
      0x57, 0x45, 0x42, 0x50, // WEBP
    ]);
    expect(detectImageSignature(webpBuffer)).toBe('image/webp');
  });

  it('rejects text files pretending to be JPEG (MIME spoofing)', () => {
    const textBuffer = Buffer.from('GIF89a spoof or plain text content here');
    expect(detectImageSignature(textBuffer)).toBeNull();
  });

  it('rejects truncated buffers (< 12 bytes)', () => {
    const shortBuffer = Buffer.from([0xff, 0xd8]);
    expect(detectImageSignature(shortBuffer)).toBeNull();
  });
});

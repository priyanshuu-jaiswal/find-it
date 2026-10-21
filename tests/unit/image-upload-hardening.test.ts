import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { ImageProcessor } from '@/src/modules/uploads/image-processor';
import { detectImageSignature } from '@/src/modules/uploads/validation';

describe('Image Upload Hardening, Signatures & Parser Verification', () => {
  const processor = new ImageProcessor();

  describe('Signature & Spoofing Detection', () => {
    it('detects authentic JPEG, PNG, and WebP buffers', async () => {
      // Create authentic 100x100 images with Sharp
      const jpeg = await sharp({
        create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } },
      })
        .jpeg()
        .toBuffer();

      const png = await sharp({
        create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } },
      })
        .png()
        .toBuffer();

      const webp = await sharp({
        create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 0, b: 255 } },
      })
        .webp()
        .toBuffer();

      expect(detectImageSignature(jpeg)).toBe('image/jpeg');
      expect(detectImageSignature(png)).toBe('image/png');
      expect(detectImageSignature(webp)).toBe('image/webp');
    });

    it('rejects text payloads with spoofed image extensions/headers', () => {
      const spoofedPayload = Buffer.from('MZ\x90\x00\x03\x00\x00\x00fake-exe-or-script');
      expect(detectImageSignature(spoofedPayload)).toBeNull();
    });
  });

  describe('Deep Parser & Malformed File Rejection', () => {
    it('successfully processes valid images into clean WebP thumbnails', async () => {
      const validPng = await sharp({
        create: { width: 600, height: 400, channels: 3, background: { r: 50, g: 100, b: 150 } },
      })
        .png()
        .toBuffer();

      const result = await processor.processToThumbnail(validPng);
      expect(result.format).toBe('webp');
      expect(result.width).toBeLessThanOrEqual(800);
      expect(result.height).toBeLessThanOrEqual(800);
    });

    it('rejects truncated/corrupt image files with clear error', async () => {
      // Valid JPEG header bytes followed by corrupted random junk
      const corruptJpeg = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
        0x00, 0x00, 0xde, 0xad, 0xbe, 0xef,
      ]);

      await expect(processor.processToThumbnail(corruptJpeg)).rejects.toThrowError(
        /Image parser failed to decode file|Corrupted or unsupported/
      );
    });

    it('rejects images exceeding maximum allowable dimensions (4096px)', async () => {
      const oversizedImage = await sharp({
        create: { width: 4097, height: 100, channels: 3, background: { r: 0, g: 0, b: 0 } },
      })
        .png()
        .toBuffer();

      await expect(processor.processToThumbnail(oversizedImage)).rejects.toThrowError(
        /exceed maximum allowed 4096x4096/
      );
    });
  });
});

import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { imageProcessor } from '@/src/modules/uploads/image-processor';

describe('ImageProcessor EXIF and GPS Stripping', () => {
  it('strips all EXIF, GPS, and camera metadata and outputs clean WebP', async () => {
    // 1. Create a synthetic test image with mock EXIF/GPS metadata
    const rawWithExif = await sharp({
      create: {
        width: 1200,
        height: 800,
        channels: 3,
        background: { r: 50, g: 100, b: 200 },
      },
    })
      .jpeg()
      .withMetadata({
        exif: {
          IFD0: {
            Make: 'TestCameraMaker',
            Model: 'TestModel123',
          },
        },
      })
      .toBuffer();

    // Verify metadata was attached to the input image
    const inputMetadata = await sharp(rawWithExif).metadata();
    expect(inputMetadata.exif).toBeDefined();

    // 2. Process image through ImageProcessor
    const result = await imageProcessor.processToThumbnail(rawWithExif);

    // 3. Verify output is WebP, dimensions are constrained, and all EXIF/GPS is stripped
    expect(result.format).toBe('webp');
    expect(result.width).toBeLessThanOrEqual(800);
    expect(result.height).toBeLessThanOrEqual(800);

    const outputMetadata = await sharp(result.buffer).metadata();
    expect(outputMetadata.format).toBe('webp');
    expect(outputMetadata.exif).toBeUndefined(); // EXIF completely stripped!
  });

  it('rejects images exceeding 4096px dimensions', async () => {
    const oversizedImage = await sharp({
      create: {
        width: 5000,
        height: 100,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer();

    await expect(imageProcessor.processToThumbnail(oversizedImage)).rejects.toThrow(
      /exceed maximum allowed 4096x4096/
    );
  });

  it('successfully decodes and converts an authentic HEIC photo to WebP thumbnail', async () => {
    const fixturePath = path.resolve(__dirname, '../fixtures/sample.heic');
    if (fs.existsSync(fixturePath)) {
      const heicBuffer = fs.readFileSync(fixturePath);
      const result = await imageProcessor.processToThumbnail(heicBuffer);

      expect(result.format).toBe('webp');
      expect(result.width).toBeLessThanOrEqual(800);
      expect(result.height).toBeLessThanOrEqual(800);

      const meta = await sharp(result.buffer).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.exif).toBeUndefined(); // EXIF stripped
    }
  });

  it('rejects corrupt HEIC image with a clean validation error', async () => {
    // Valid ftyp heic box followed by random corrupted payload
    const corruptHeic = Buffer.alloc(40);
    corruptHeic.writeUInt32BE(40, 0);
    corruptHeic.write('ftyp', 4);
    corruptHeic.write('heic', 8);
    corruptHeic.fill(0xee, 12);

    await expect(imageProcessor.processToThumbnail(corruptHeic)).rejects.toThrow(
      /Failed to decode HEIC\/HEIF photo/
    );
  });
});

import sharp, { Metadata } from 'sharp';
import { AppError } from '@/src/lib/errors';
import { detectImageSignature } from './validation';

export interface ProcessedImageResult {
  buffer: Buffer;
  width: number;
  height: number;
  format: 'webp';
}

export class ImageProcessor {
  private static readonly MAX_DIMENSION = 4096;
  private static readonly MAX_PIXELS = 16_777_216; // 4096 * 4096
  private static readonly THUMBNAIL_MAX_WIDTH = 800;
  private static readonly THUMBNAIL_MAX_HEIGHT = 800;

  /**
   * Strips all EXIF, GPS, and camera metadata, ensures dimensions are within limits,
   * validates format via parser against decompression bombs, and converts to optimized WebP.
   */
  async processToThumbnail(inputBuffer: Buffer): Promise<ProcessedImageResult> {
    const signature = detectImageSignature(inputBuffer);
    if (!signature) {
      throw new AppError(
        'INVALID_STATE',
        'Corrupted or unsupported image file header. Must be a valid JPEG, PNG, or WebP image.'
      );
    }

    let metadata: Metadata;
    try {
      metadata = await sharp(inputBuffer, {
        failOn: 'error',
        limitInputPixels: ImageProcessor.MAX_PIXELS,
      }).metadata();
    } catch {
      throw new AppError(
        'INVALID_STATE',
        'Image parser failed to decode file. The image payload may be malformed, corrupted, or a decompression bomb.'
      );
    }

    if (!metadata.width || !metadata.height) {
      throw new AppError('INVALID_STATE', 'Unable to determine image dimensions or invalid image format');
    }

    if (
      metadata.width > ImageProcessor.MAX_DIMENSION ||
      metadata.height > ImageProcessor.MAX_DIMENSION
    ) {
      throw new AppError(
        'INVALID_STATE',
        `Image dimensions ${metadata.width}x${metadata.height} exceed maximum allowed ${ImageProcessor.MAX_DIMENSION}x${ImageProcessor.MAX_DIMENSION}`
      );
    }

    if (metadata.width * metadata.height > ImageProcessor.MAX_PIXELS) {
      throw new AppError(
        'INVALID_STATE',
        `Image total pixel count exceeds maximum allowable ceiling of ${ImageProcessor.MAX_PIXELS} pixels.`
      );
    }

    // Auto-rotate according to EXIF orientation, resize to thumbnail bounds,
    // strip all metadata (sharp does not include EXIF unless .withMetadata() is specified),
    // and encode as WebP.
    let processedBuffer: Buffer;
    try {
      processedBuffer = await sharp(inputBuffer, {
        failOn: 'error',
        limitInputPixels: ImageProcessor.MAX_PIXELS,
      })
        .rotate() // Handles orientation before stripping EXIF
        .resize(ImageProcessor.THUMBNAIL_MAX_WIDTH, ImageProcessor.THUMBNAIL_MAX_HEIGHT, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 80, effort: 4 })
        .toBuffer();
    } catch {
      throw new AppError('INVALID_STATE', 'Image conversion to WebP thumbnail failed.');
    }

    const resultMetadata = await sharp(processedBuffer).metadata();

    return {
      buffer: processedBuffer,
      width: resultMetadata.width || 0,
      height: resultMetadata.height || 0,
      format: 'webp',
    };
  }
}

export const imageProcessor = new ImageProcessor();

import sharp, { Metadata } from 'sharp';
import convert from 'heic-convert';
import { AppError } from '@/src/lib/errors';
import { detectImageSignature } from './validation';

export interface ProcessedImageResult {
  buffer: Buffer;
  width: number;
  height: number;
  format: 'webp';
}

export class ImageProcessor {
  public static readonly MAX_DIMENSION = 4096;
  public static readonly MAX_PIXELS = 16_777_216; // 4096 * 4096
  public static readonly THUMBNAIL_MAX_WIDTH = 800;
  public static readonly THUMBNAIL_MAX_HEIGHT = 800;

  /**
   * Decodes input image (including iPhone HEIC/HEIF photos), strips all EXIF, GPS, and camera metadata,
   * ensures dimensions are within limits, validates format via parser against decompression bombs,
   * and converts to optimized WebP thumbnail.
   */
  async processToThumbnail(inputBuffer: Buffer): Promise<ProcessedImageResult> {
    const signature = detectImageSignature(inputBuffer);
    if (!signature) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Corrupted or unsupported image file header. Must be a valid JPEG, PNG, WebP, or HEIC/HEIF image.'
      );
    }

    let workingBuffer = inputBuffer;
    if (signature === 'image/heic' || signature === 'image/heif') {
      try {
        const converted = await convert({
          buffer: inputBuffer,
          format: 'JPEG',
          quality: 0.9,
        });
        workingBuffer = Buffer.isBuffer(converted)
          ? converted
          : Buffer.from(converted as ArrayBuffer);
      } catch {
        throw new AppError(
          'VALIDATION_ERROR',
          'Failed to decode HEIC/HEIF photo. The file may be corrupted, truncated, or malformed.'
        );
      }
    }

    let metadata: Metadata;
    try {
      metadata = await sharp(workingBuffer, {
        failOn: 'error',
        limitInputPixels: ImageProcessor.MAX_PIXELS,
      }).metadata();
    } catch {
      throw new AppError(
        'VALIDATION_ERROR',
        'Image parser failed to decode file. The image payload may be malformed, corrupted, or a decompression bomb.'
      );
    }

    if (!metadata.width || !metadata.height) {
      throw new AppError('VALIDATION_ERROR', 'Unable to determine image dimensions or invalid image format');
    }

    if (
      metadata.width > ImageProcessor.MAX_DIMENSION ||
      metadata.height > ImageProcessor.MAX_DIMENSION
    ) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Image dimensions ${metadata.width}x${metadata.height} exceed maximum allowed ${ImageProcessor.MAX_DIMENSION}x${ImageProcessor.MAX_DIMENSION}`
      );
    }

    if (metadata.width * metadata.height > ImageProcessor.MAX_PIXELS) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Image total pixel count exceeds maximum allowable ceiling of ${ImageProcessor.MAX_PIXELS} pixels.`
      );
    }

    // Auto-rotate according to EXIF orientation, resize to thumbnail bounds,
    // strip all metadata (sharp does not include EXIF unless .withMetadata() is specified),
    // and encode as WebP.
    let processedBuffer: Buffer;
    try {
      processedBuffer = await sharp(workingBuffer, {
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
      throw new AppError('VALIDATION_ERROR', 'Image conversion to WebP thumbnail failed.');
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

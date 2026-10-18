import sharp from 'sharp';
import { AppError } from '@/src/lib/errors';

export interface ProcessedImageResult {
  buffer: Buffer;
  width: number;
  height: number;
  format: 'webp';
}

export class ImageProcessor {
  private static readonly MAX_DIMENSION = 4096;
  private static readonly THUMBNAIL_MAX_WIDTH = 800;
  private static readonly THUMBNAIL_MAX_HEIGHT = 800;

  /**
   * Strips all EXIF, GPS, and camera metadata, ensures dimensions are within limits,
   * and converts the image to an optimized WebP thumbnail.
   */
  async processToThumbnail(inputBuffer: Buffer): Promise<ProcessedImageResult> {
    const image = sharp(inputBuffer);
    const metadata = await image.metadata();

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

    // Auto-rotate according to EXIF orientation, resize to thumbnail bounds,
    // strip all metadata (sharp does not include EXIF unless .withMetadata() is specified),
    // and encode as WebP.
    const processedBuffer = await sharp(inputBuffer)
      .rotate() // Handles orientation before stripping EXIF
      .resize(ImageProcessor.THUMBNAIL_MAX_WIDTH, ImageProcessor.THUMBNAIL_MAX_HEIGHT, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 80, effort: 4 })
      .toBuffer();

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

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@/src/lib/env';
import { AppError } from '@/src/lib/errors';
import { MAX_UPLOAD_BYTES } from './schema';

export interface StorageObjectMetadata {
  contentLength: number;
  contentType?: string;
  etag?: string;
  lastModified?: Date;
}

export class StorageAdapter {
  private client: S3Client | null = null;
  private bucket: string;
  private isConfigured: boolean = false;

  constructor() {
    this.bucket = env.STORAGE_BUCKET;

    const endpoint = env.STORAGE_ENDPOINT;
    const isLocalhost = endpoint.includes('localhost') || endpoint.includes('127.0.0.1');

    // On Vercel / production environments, a localhost endpoint or dummy minio credentials
    // means external cloud storage (Supabase S3 / AWS S3) was not provisioned.
    const isProduction = process.env.NODE_ENV === 'production';
    const isUnconfiguredInProd =
      isProduction &&
      (isLocalhost ||
        (env.STORAGE_ACCESS_KEY_ID === 'minioadmin' &&
          !endpoint.includes('supabase') &&
          !endpoint.includes('amazonaws') &&
          !endpoint.includes('r2.cloudflarestorage')));

    if (!isUnconfiguredInProd) {
      try {
        this.client = new S3Client({
          endpoint: env.STORAGE_ENDPOINT,
          region: env.STORAGE_REGION,
          credentials: {
            accessKeyId: env.STORAGE_ACCESS_KEY_ID,
            secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
          },
          forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
          maxAttempts: 2,
        });
        this.isConfigured = true;
      } catch {
        this.client = null;
        this.isConfigured = false;
      }
    } else {
      this.client = null;
      this.isConfigured = false;
    }
  }

  /**
   * Returns true if external cloud storage (MinIO / Supabase / S3) is active and reachable.
   */
  isStorageEnabled(): boolean {
    return this.isConfigured && this.client !== null;
  }

  /**
   * Retrieves object metadata (ContentLength, ContentType) without downloading body.
   */
  async headObject(objectKey: string): Promise<StorageObjectMetadata | null> {
    if (!this.isStorageEnabled() || !this.client) {
      return null;
    }

    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
      });

      const response = await this.client.send(command, {
        abortSignal: AbortSignal.timeout(4000),
      });

      return {
        contentLength: response.ContentLength ?? 0,
        contentType: response.ContentType,
        etag: response.ETag,
        lastModified: response.LastModified,
      };
    } catch (err: any) {
      if (
        err.name === 'NotFound' ||
        err.name === 'NoSuchKey' ||
        err.$metadata?.httpStatusCode === 404
      ) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Generates a presigned PUT URL.
   * Note on provider behavior: Signs Content-Length as best-effort upload-time enforcement
   * for providers that validate it (e.g., AWS S3 with SigV4 signed headers).
   * Because S3-compatible providers (such as Supabase Storage or MinIO) may not strictly
   * reject mismatched body sizes at upload time, authoritative size enforcement is performed
   * post-upload via headObject metadata inspection and bounded stream reading.
   */
  async getPresignedPutUrl(
    objectKey: string,
    contentType: string,
    byteSize?: number,
    expiresInSeconds = 900
  ): Promise<string> {
    if (!this.isStorageEnabled() || !this.client) {
      throw new Error(
        'External S3/Supabase storage is not configured for production. Please use direct server upload.'
      );
    }

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ContentType: contentType,
      ...(byteSize !== undefined ? { ContentLength: byteSize } : {}),
    });

    return getSignedUrl(this.client, command, {
      expiresIn: expiresInSeconds,
      ...(byteSize !== undefined
        ? { unhoistableHeaders: new Set(['content-length']) }
        : {}),
    });
  }

  async getPresignedGetUrl(
    objectKey: string,
    expiresInSeconds = 3600
  ): Promise<string> {
    if (!this.isStorageEnabled() || !this.client) {
      throw new Error('External S3/Supabase storage is not configured.');
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
    });

    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  /**
   * Streams an object from storage into memory with strict incremental byte bounding.
   * Defends worker memory against oversized uploads by terminating chunk-by-chunk
   * before accumulating into RAM. Never relies on unbounded buffering methods.
   */
  async getObjectBuffer(objectKey: string, maxBytes = MAX_UPLOAD_BYTES): Promise<Buffer> {
    if (!this.isStorageEnabled() || !this.client) {
      throw new Error('External storage is not configured.');
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
    });

    // 4-second timeout to avoid exceeding Vercel serverless function limits
    const response = await this.client.send(command, {
      abortSignal: AbortSignal.timeout(4000),
    });

    if (!response.Body) {
      throw new Error(`Empty body returned for object key: ${objectKey}`);
    }

    // 1. Pre-download check: If provider reports ContentLength > maxBytes, abort immediately
    if (response.ContentLength !== undefined && response.ContentLength > maxBytes) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Object size (${response.ContentLength} bytes) exceeds maximum allowable limit of ${maxBytes} bytes`
      );
    }

    // 2. Incremental bounded streaming reader: chunk-by-chunk counting before accumulation
    const bodyStream = response.Body as any;

    // Pattern A: Web Streams (ReadableStream with getReader)
    if (bodyStream && typeof bodyStream.getReader === 'function') {
      const reader = bodyStream.getReader();
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
          totalBytes += buf.length;
          if (totalBytes > maxBytes) {
            await reader.cancel();
            throw new AppError(
              'VALIDATION_ERROR',
              `Streamed object exceeded maximum allowable limit of ${maxBytes} bytes`
            );
          }
          chunks.push(buf);
        }
        return Buffer.concat(chunks);
      } finally {
        reader.releaseLock?.();
      }
    }

    // Pattern B: Node.js Streams / AsyncIterable (for await (const chunk of stream))
    if (bodyStream && typeof bodyStream[Symbol.asyncIterator] === 'function') {
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      for await (const chunk of bodyStream) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buf.length;
        if (totalBytes > maxBytes) {
          if (typeof bodyStream.destroy === 'function') {
            bodyStream.destroy();
          }
          throw new AppError(
            'VALIDATION_ERROR',
            `Streamed object exceeded maximum allowable limit of ${maxBytes} bytes`
          );
        }
        chunks.push(buf);
      }
      return Buffer.concat(chunks);
    }

    // Pattern C: If body type cannot be safely bounded incrementally, fail closed immediately
    throw new AppError(
      'VALIDATION_ERROR',
      `Storage body stream type cannot be safely bounded; failing closed`
    );
  }

  async putObject(
    objectKey: string,
    body: Buffer,
    contentType: string
  ): Promise<void> {
    if (!this.isStorageEnabled() || !this.client) {
      throw new Error('External storage is not configured; using database fallback.');
    }

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      Body: body,
      ContentType: contentType,
    });

    // 4-second timeout to guarantee fast fallback if external bucket is unreachable
    await this.client.send(command, {
      abortSignal: AbortSignal.timeout(4000),
    });
  }

  /**
   * Deletes an object from remote storage.
   *
   * Error Handling & Idempotency Contract:
   * - Resolves successfully when the object is deleted or confirmed already absent (404 / NoSuchKey / NotFound).
   * - Throws if external storage is not configured/enabled.
   * - Throws transient/provider errors (500, 503, network timeouts) to callers without swallowing,
   *   allowing callers to retain durable database state and schedule retries.
   */
  async deleteObject(objectKey: string): Promise<void> {
    if (!objectKey) {
      throw new Error('objectKey is required for storage deletion');
    }

    if (!this.isStorageEnabled() || !this.client) {
      throw new Error('External storage is not configured; cannot delete remote object');
    }

    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
      });
      await this.client.send(command, {
        abortSignal: AbortSignal.timeout(4000),
      });
    } catch (err: any) {
      // If the object is confirmed already absent, treat as idempotent success
      if (
        err.name === 'NoSuchKey' ||
        err.name === 'NotFound' ||
        err.$metadata?.httpStatusCode === 404
      ) {
        return;
      }
      // Re-throw transient/provider errors so callers can preserve durable state and retry
      throw err;
    }
  }
}

export const storageAdapter = new StorageAdapter();

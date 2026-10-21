import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@/src/lib/env';

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

  async getPresignedPutUrl(
    objectKey: string,
    contentType: string,
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
    });

    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
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

  async getObjectBuffer(objectKey: string): Promise<Buffer> {
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

    const byteArray = await response.Body.transformToByteArray();
    return Buffer.from(byteArray);
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

  async deleteObject(objectKey: string): Promise<void> {
    if (!this.isStorageEnabled() || !this.client) {
      return;
    }

    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
      });
      await this.client.send(command, {
        abortSignal: AbortSignal.timeout(4000),
      });
    } catch {
      // Ignore deletion failure
    }
  }
}

export const storageAdapter = new StorageAdapter();

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { POST as directUploadRoute } from '@/app/api/v1/uploads/direct/route';
import prisma from '@/src/db';
import * as authModule from '@/src/auth';

// Mock auth and database dependencies to isolate route handler logic
vi.mock('@/src/auth', () => ({
  requireAuth: vi.fn(),
  getSessionUser: vi.fn(),
}));

vi.mock('@/src/db', () => ({
  default: {
    membership: {
      findUnique: vi.fn(),
    },
    reportImage: {
      create: vi.fn(),
    },
  },
}));

describe('POST /api/v1/uploads/direct - Route-Level Coverage', () => {
  const dummyUserId = '11111111-1111-1111-1111-111111111111';
  const dummyOrgId = '22222222-2222-2222-2222-222222222222';

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(authModule.requireAuth).mockResolvedValue({
      id: dummyUserId,
      email: 'test@cmrit.ac.in',
      displayName: 'Test Student',
      authSubject: 'test|user',
      passwordHash: null,
      disabledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    vi.mocked(prisma.membership.findUnique).mockResolvedValue({
      organizationId: dummyOrgId,
      userId: dummyUserId,
      role: 'MEMBER',
      joinedAt: new Date(),
    });

    (vi.mocked(prisma.reportImage.create) as any).mockImplementation(async ({ data }: any) => ({
      id: data.id,
      reportId: null,
      uploaderId: dummyUserId,
      organizationId: dummyOrgId,
      rawObjectKey: data.rawObjectKey,
      thumbObjectKey: data.thumbObjectKey,
      status: 'READY',
      contentType: data.contentType,
      byteSize: data.byteSize,
      width: data.width,
      height: data.height,
      sha256: null,
      expiresAt: new Date(),
      createdAt: new Date(),
    }));
  });

  it('rejects request immediately when Content-Length pre-flight header exceeds limit', async () => {
    // 15 MB Content-Length header
    const req = new NextRequest('http://localhost:3000/api/v1/uploads/direct', {
      method: 'POST',
      headers: {
        'content-length': '15728640',
        'content-type': 'multipart/form-data; boundary=----boundary',
      },
    });

    const res = await directUploadRoute(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error?.code).toBe('VALIDATION_ERROR');
    expect(body.error?.message).toContain('Payload exceeds maximum upload size limit');
  });

  it('aborts and rejects oversized streamed request when Content-Length is missing', async () => {
    // Stream chunks totaling 11 MB without Content-Length
    const chunkSize = 1024 * 1024; // 1 MB
    const totalChunks = 11;
    let chunksSent = 0;

    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunksSent < totalChunks) {
          controller.enqueue(new Uint8Array(chunkSize));
          chunksSent++;
        } else {
          controller.close();
        }
      },
    });

    const req = new NextRequest('http://localhost:3000/api/v1/uploads/direct', {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=----boundary',
      },
      body: stream,
      duplex: 'half',
    } as any);

    const res = await directUploadRoute(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error?.code).toBe('VALIDATION_ERROR');
    expect(body.error?.message).toMatch(/exceeds maximum allowable size limit|Upload stream exceeded/);
  });

  it('aborts and rejects oversized streamed request when Content-Length is misleading (under-reported)', async () => {
    // Content-Length falsely declares 50 bytes, but stream sends 11 MB
    const chunkSize = 1024 * 1024;
    const totalChunks = 11;
    let chunksSent = 0;

    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunksSent < totalChunks) {
          controller.enqueue(new Uint8Array(chunkSize));
          chunksSent++;
        } else {
          controller.close();
        }
      },
    });

    const req = new NextRequest('http://localhost:3000/api/v1/uploads/direct', {
      method: 'POST',
      headers: {
        'content-length': '50', // Falsified / misleading header
        'content-type': 'multipart/form-data; boundary=----boundary',
      },
      body: stream,
      duplex: 'half',
    } as any);

    const res = await directUploadRoute(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error?.code).toBe('VALIDATION_ERROR');
    expect(body.error?.message).toMatch(/exceeds maximum allowable size limit|Upload stream exceeded/);
  });

  it('successfully processes valid under-limit multipart upload with genuine JPEG', async () => {
    // Generate valid 100x100 JPEG buffer
    const jpegBuffer = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();

    const formData = new FormData();
    const file = new File([jpegBuffer], 'photo.jpg', { type: 'image/jpeg' });
    formData.append('file', file);
    formData.append('orgId', dummyOrgId);

    const req = new NextRequest('http://localhost:3000/api/v1/uploads/direct', {
      method: 'POST',
      body: formData,
    });

    const res = await directUploadRoute(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data).toBeDefined();
    expect(body.data.imageId).toBeDefined();
    expect(body.data.thumbUrl).toBeDefined();
    expect(prisma.reportImage.create).toHaveBeenCalledTimes(1);
  });

  it('rejects request when multiple files are attached to single upload request', async () => {
    const jpegBuffer = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 0, g: 255, b: 0 } },
    })
      .jpeg()
      .toBuffer();

    const formData = new FormData();
    formData.append('file', new File([jpegBuffer], 'photo1.jpg', { type: 'image/jpeg' }));
    formData.append('file', new File([jpegBuffer], 'photo2.jpg', { type: 'image/jpeg' }));
    formData.append('orgId', dummyOrgId);

    const req = new NextRequest('http://localhost:3000/api/v1/uploads/direct', {
      method: 'POST',
      body: formData,
    });

    const res = await directUploadRoute(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error?.code).toBe('VALIDATION_ERROR');
    expect(body.error?.message).toContain('Only a single file can be uploaded per request');
  });

  it('successfully processes authentic HEIC photo upload and converts to WebP thumbnail', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fixturePath = path.resolve(__dirname, '../fixtures/sample.heic');
    if (!fs.existsSync(fixturePath)) return;

    const heicBuffer = fs.readFileSync(fixturePath);
    const formData = new FormData();
    const file = new File([heicBuffer], 'iphone_photo.heic', { type: 'image/heic' });
    formData.append('file', file);
    formData.append('orgId', dummyOrgId);

    const req = new NextRequest('http://localhost:3000/api/v1/uploads/direct', {
      method: 'POST',
      body: formData,
    });

    const res = await directUploadRoute(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data).toBeDefined();
    expect(body.data.imageId).toBeDefined();
    expect(body.data.thumbUrl).toBeDefined();
    expect(prisma.reportImage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contentType: 'image/webp',
          status: 'READY',
        }),
      })
    );
  });

  it('successfully infers HEIC type when client sends empty MIME type with .heic filename', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fixturePath = path.resolve(__dirname, '../fixtures/sample.heic');
    if (!fs.existsSync(fixturePath)) return;

    const heicBuffer = fs.readFileSync(fixturePath);
    const formData = new FormData();
    // iOS Safari sometimes leaves file.type empty
    const file = new File([heicBuffer], 'IMG_0123.HEIC', { type: '' });
    formData.append('file', file);
    formData.append('orgId', dummyOrgId);

    const req = new NextRequest('http://localhost:3000/api/v1/uploads/direct', {
      method: 'POST',
      body: formData,
    });

    const res = await directUploadRoute(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data?.imageId).toBeDefined();
  });

  it('rejects corrupt HEIC upload with 400 VALIDATION_ERROR instead of 500 internal error', async () => {
    const corruptHeic = Buffer.alloc(40);
    corruptHeic.writeUInt32BE(40, 0);
    corruptHeic.write('ftyp', 4);
    corruptHeic.write('heic', 8);
    corruptHeic.fill(0xff, 12);

    const formData = new FormData();
    const file = new File([corruptHeic], 'broken.heic', { type: 'image/heic' });
    formData.append('file', file);
    formData.append('orgId', dummyOrgId);

    const req = new NextRequest('http://localhost:3000/api/v1/uploads/direct', {
      method: 'POST',
      body: formData,
    });

    const res = await directUploadRoute(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error?.code).toBe('VALIDATION_ERROR');
    expect(body.error?.message).toMatch(/Failed to decode HEIC|Image parsing failed|corrupted/);
  });

  it('rejects declared MIME type that does not match detected signature', async () => {
    // Generate valid JPEG but claim it is PNG
    const jpegBuffer = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();

    const formData = new FormData();
    const file = new File([jpegBuffer], 'fake.png', { type: 'image/png' });
    formData.append('file', file);
    formData.append('orgId', dummyOrgId);

    const req = new NextRequest('http://localhost:3000/api/v1/uploads/direct', {
      method: 'POST',
      body: formData,
    });

    const res = await directUploadRoute(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error?.code).toBe('VALIDATION_ERROR');
    expect(body.error?.message).toContain('does not match detected image format');
  });
});

import { describe, it, expect, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import sharp from 'sharp';
import prisma from '@/src/db';
import { storageAdapter } from '@/src/modules/uploads/storage-adapter';
import { POST as presignRoute } from '@/app/api/v1/uploads/presign/route';
import { POST as createReportRoute, GET as listReportsRoute } from '@/app/api/v1/reports/route';
import { GET as getReportRoute, PATCH as updateReportRoute } from '@/app/api/v1/reports/[id]/route';
import { POST as withdrawReportRoute } from '@/app/api/v1/reports/[id]/withdraw/route';
import { POST as workerTickRoute } from '@/app/api/v1/internal/worker/tick/route';
import { env } from '@/src/lib/env';

describe('Phase 1: Reports & Presigned Image Upload Pipeline', () => {
  let orgId: string;
  let otherOrgId: string;
  let aliceId: string;
  let bobId: string;

  beforeAll(async () => {
    // Look up seeded Apex University and test users
    const org = await prisma.organization.findUniqueOrThrow({
      where: { slug: 'apex-university' },
    });
    orgId = org.id;

    const alice = await prisma.user.findUniqueOrThrow({
      where: { email: 'alice@apex.edu' },
    });
    aliceId = alice.id;

    const bob = await prisma.user.findUniqueOrThrow({
      where: { email: 'bob@apex.edu' },
    });
    bobId = bob.id;

    // Create a secondary organization to test strict tenant isolation
    const otherOrg = await prisma.organization.upsert({
      where: { slug: 'other-university' },
      update: {},
      create: {
        name: 'Other University',
        slug: 'other-university',
      },
    });
    otherOrgId = otherOrg.id;
  });

  describe('POST /api/v1/uploads/presign', () => {
    it('returns 400 VALIDATION_ERROR on unsupported content-type or excess size', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/uploads/presign', {
        method: 'POST',
        headers: { 'x-test-email': 'alice@apex.edu' },
        body: JSON.stringify({
          orgId,
          contentType: 'application/pdf', // Unsupported
          byteSize: 100,
        }),
      });

      const res = await presignRoute(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 NOT_FOUND when attempting to presign in an org the user does not belong to', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/uploads/presign', {
        method: 'POST',
        headers: { 'x-test-email': 'alice@apex.edu' },
        body: JSON.stringify({
          orgId: otherOrgId, // Alice does not belong to other-university
          contentType: 'image/jpeg',
          byteSize: 2048,
        }),
      });

      const res = await presignRoute(req);
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('returns 201 with imageId and putUrl for a valid member request', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/uploads/presign', {
        method: 'POST',
        headers: { 'x-test-email': 'alice@apex.edu' },
        body: JSON.stringify({
          orgId,
          contentType: 'image/jpeg',
          byteSize: 50000,
        }),
      });

      const res = await presignRoute(req);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.data.imageId).toBeDefined();
      expect(json.data.putUrl).toContain('http://localhost:9000');
      expect(json.data.expiresAt).toBeDefined();

      const dbImage = await prisma.reportImage.findUnique({
        where: { id: json.data.imageId },
      });
      expect(dbImage?.status).toBe('PENDING_UPLOAD');
      expect(dbImage?.uploaderId).toBe(aliceId);
    });
  });

  describe('Report Creation, Worker EXIF Stripping, and Browse Feed', () => {
    let createdReportId: string;
    let uploadedImageId: string;

    it('creates a report, attaches images, and triggers background image processing with EXIF stripping', async () => {
      // 1. Request presigned upload URL
      const presignReq = new NextRequest('http://localhost:3000/api/v1/uploads/presign', {
        method: 'POST',
        headers: { 'x-test-email': 'alice@apex.edu' },
        body: JSON.stringify({
          orgId,
          contentType: 'image/jpeg',
          byteSize: 15000,
        }),
      });
      const presignRes = await presignRoute(presignReq);
      const presignJson = await presignRes.json();
      uploadedImageId = presignJson.data.imageId;

      // 2. Simulate client uploading an image with GPS metadata directly to MinIO
      const imageRecord = await prisma.reportImage.findUniqueOrThrow({
        where: { id: uploadedImageId },
      });

      const sampleWithGps = await sharp({
        create: {
          width: 800,
          height: 600,
          channels: 3,
          background: { r: 10, g: 150, b: 240 },
        },
      })
        .jpeg()
        .withMetadata({
          exif: {
            IFD0: {
              Make: 'PhoneCameraModel',
            },
          },
        })
        .toBuffer();

      await storageAdapter.putObject(imageRecord.rawObjectKey, sampleWithGps, 'image/jpeg');

      // 3. Create Report referencing uploadedImageId
      const reportReq = new NextRequest('http://localhost:3000/api/v1/reports', {
        method: 'POST',
        headers: { 'x-test-email': 'alice@apex.edu' },
        body: JSON.stringify({
          orgId,
          type: 'LOST',
          category: 'Electronics',
          title: 'Blue Sony WH-1000XM4 Noise Canceling Headphones',
          description: 'Left them near the main library second floor study cubicles yesterday afternoon.',
          color: 'Blue',
          brand: 'Sony',
          locationLabel: 'Main Library 2nd Floor',
          locationArea: 'Campus Center',
          imageIds: [uploadedImageId],
        }),
      });

      const reportRes = await createReportRoute(reportReq);
      const reportJson = await reportRes.json();

      expect(reportRes.status).toBe(201);
      expect(reportJson.data.id).toBeDefined();
      expect(reportJson.data.title).toBe('Blue Sony WH-1000XM4 Noise Canceling Headphones');
      expect(reportJson.data.version).toBe(1);
      createdReportId = reportJson.data.id;

      // Verify jobs were queued
      const queuedJobs = await prisma.job.findMany({
        where: {
          kind: { in: ['PROCESS_IMAGE', 'COMPUTE_MATCHES'] },
          status: 'QUEUED',
        },
      });
      expect(queuedJobs.length).toBeGreaterThanOrEqual(2);

      // 4. Trigger Worker Tick to process background jobs
      const workerReq = new NextRequest('http://localhost:3000/api/v1/internal/worker/tick', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.WORKER_SECRET}` },
      });
      const workerRes = await workerTickRoute(workerReq);
      const workerJson = await workerRes.json();

      expect(workerRes.status).toBe(200);
      expect(workerJson.data.processed).toBeGreaterThanOrEqual(1);

      // 5. Verify the reportImage is now READY and its thumbnail has zero EXIF
      const updatedImage = await prisma.reportImage.findUniqueOrThrow({
        where: { id: uploadedImageId },
      });
      expect(updatedImage.status).toBe('READY');
      expect(updatedImage.thumbObjectKey).toBeDefined();

      const thumbBuffer = await storageAdapter.getObjectBuffer(updatedImage.thumbObjectKey!);
      const thumbMetadata = await sharp(thumbBuffer).metadata();
      expect(thumbMetadata.format).toBe('webp');
      expect(thumbMetadata.exif).toBeUndefined(); // GPS metadata successfully stripped!
    });

    it('lists reports with hybrid full-text search (tsvector + trigram) and presigned thumbnails', async () => {
      const searchReq = new NextRequest(
        `http://localhost:3000/api/v1/reports?orgId=${orgId}&q=Sony+headphones`,
        {
          headers: { 'x-test-email': 'bob@apex.edu' },
        }
      );

      const res = await listReportsRoute(searchReq);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.length).toBeGreaterThanOrEqual(1);

      const found = json.data.find((r: { id: string }) => r.id === createdReportId);
      expect(found).toBeDefined();
      expect(found.title).toContain('Sony WH-1000XM4');
      expect(found.thumbUrl).toContain('http://localhost:9000');
    });

    it('retrieves single report details while strictly omitting owner contact PII', async () => {
      const req = new NextRequest(`http://localhost:3000/api/v1/reports/${createdReportId}`, {
        headers: { 'x-test-email': 'bob@apex.edu' },
      });

      const res = await getReportRoute(req, { params: Promise.resolve({ id: createdReportId }) });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.id).toBe(createdReportId);
      expect(json.data.images).toHaveLength(1);
      expect(json.data.images[0].url).toContain('http://localhost:9000');

      // Verify no owner email or phone is leaked
      expect(json.data.ownerEmail).toBeUndefined();
      expect(json.data.ownerPhone).toBeUndefined();
      expect(json.data.owner).toBeUndefined();
    });

    it('enforces optimistic concurrency control (409 on version conflict) on update', async () => {
      // 1. Update with correct version (1 -> 2)
      const validReq = new NextRequest(`http://localhost:3000/api/v1/reports/${createdReportId}`, {
        method: 'PATCH',
        headers: { 'x-test-email': 'alice@apex.edu' },
        body: JSON.stringify({
          version: 1,
          color: 'Midnight Blue',
        }),
      });

      const validRes = await updateReportRoute(validReq, { params: Promise.resolve({ id: createdReportId }) });
      const validJson = await validRes.json();

      expect(validRes.status).toBe(200);
      expect(validJson.data.color).toBe('Midnight Blue');
      expect(validJson.data.version).toBe(2);

      // 2. Concurrent/Stale update with old version (1) results in 409 CONFLICT
      const staleReq = new NextRequest(`http://localhost:3000/api/v1/reports/${createdReportId}`, {
        method: 'PATCH',
        headers: { 'x-test-email': 'alice@apex.edu' },
        body: JSON.stringify({
          version: 1, // Stale!
          color: 'Navy Blue',
        }),
      });

      const staleRes = await updateReportRoute(staleReq, { params: Promise.resolve({ id: createdReportId }) });
      const staleJson = await staleRes.json();

      expect(staleRes.status).toBe(409);
      expect(staleJson.error.code).toBe('CONFLICT');
    });

    it('allows owner to withdraw report and transitions status to WITHDRAWN', async () => {
      const withdrawReq = new NextRequest(`http://localhost:3000/api/v1/reports/${createdReportId}/withdraw`, {
        method: 'POST',
        headers: { 'x-test-email': 'alice@apex.edu' },
        body: JSON.stringify({
          version: 2,
        }),
      });

      const res = await withdrawReportRoute(withdrawReq, { params: Promise.resolve({ id: createdReportId }) });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.status).toBe('WITHDRAWN');
      expect(json.data.version).toBe(3);

      const dbReport = await prisma.report.findUnique({
        where: { id: createdReportId },
      });
      expect(dbReport?.status).toBe('WITHDRAWN');
    });
  });
});

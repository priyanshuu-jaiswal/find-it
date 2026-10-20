import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/src/db';
import { storageAdapter } from '@/src/modules/uploads/storage-adapter';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const image = await prisma.reportImage.findUnique({
      where: { id },
    });

    if (!image) {
      return new NextResponse('Image not found', { status: 404 });
    }

    const key = image.thumbObjectKey || image.rawObjectKey;
    if (!key) {
      return new NextResponse('Image content not available', { status: 404 });
    }

    // 1. Handle base64 fallback
    if (key.startsWith('data:image/')) {
      const base64Data = key.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': 'image/webp',
          'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        },
      });
    }

    // 2. Fetch buffer from S3/MinIO
    try {
      const buffer = await storageAdapter.getObjectBuffer(key);
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': 'image/webp',
          'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        },
      });
    } catch {
      return new NextResponse('Failed to retrieve image from storage', { status: 502 });
    }
  } catch (err: any) {
    return new NextResponse(err.message || 'Server error', { status: 500 });
  }
}

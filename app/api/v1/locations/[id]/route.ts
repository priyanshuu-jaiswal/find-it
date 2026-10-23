import { NextRequest } from 'next/server';
import prisma from '@/src/db';
import { requireAuth } from '@/src/auth';
import { successResponse, errorResponse } from '@/src/lib/response';
import { AppError } from '@/src/lib/errors';
import { z } from 'zod';

const UpdateLocationSchema = z.object({
  name: z.string().trim().min(2, 'Location name must be at least 2 characters').max(100, 'Location name cannot exceed 100 characters').optional(),
  area: z.string().trim().max(100, 'Area name cannot exceed 100 characters').optional().nullable(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuth(req);
    const { id } = await params;

    const existingLocation = await prisma.campusLocation.findUnique({
      where: { id },
    });

    if (!existingLocation) {
      throw new AppError('NOT_FOUND', 'Campus location not found');
    }

    // Authorization: User MUST be ORG_ADMIN of this organization
    const membership = await prisma.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: existingLocation.organizationId,
          userId: user.id,
        },
      },
    });

    if (!membership || membership.role !== 'ORG_ADMIN') {
      throw new AppError('FORBIDDEN', 'Only campus administrators can modify campus locations.');
    }

    const body = await req.json().catch(() => null);
    const parsed = UpdateLocationSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', parsed.error.issues[0]?.message || 'Invalid update data');
    }

    const { name, area, isActive, sortOrder } = parsed.data;

    const updatedData: any = {};
    if (name !== undefined) updatedData.name = name;
    if (area !== undefined) updatedData.area = area;
    if (isActive !== undefined) updatedData.isActive = isActive;
    if (sortOrder !== undefined) updatedData.sortOrder = sortOrder;

    const updatedLocation = await prisma.campusLocation.update({
      where: { id },
      data: updatedData,
    });

    // Immutable audit logging
    await prisma.auditEvent.create({
      data: {
        organizationId: existingLocation.organizationId,
        actorId: user.id,
        action: 'CAMPUS_LOCATION_UPDATED',
        entityType: 'CAMPUS_LOCATION',
        entityId: updatedLocation.id,
        metadata: {
          previous: {
            name: existingLocation.name,
            area: existingLocation.area,
            isActive: existingLocation.isActive,
            sortOrder: existingLocation.sortOrder,
          },
          updated: updatedData,
        },
      },
    });

    return successResponse(updatedLocation);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuth(req);
    const { id } = await params;

    const existingLocation = await prisma.campusLocation.findUnique({
      where: { id },
    });

    if (!existingLocation) {
      throw new AppError('NOT_FOUND', 'Campus location not found');
    }

    // Authorization: User MUST be ORG_ADMIN of this organization
    const membership = await prisma.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: existingLocation.organizationId,
          userId: user.id,
        },
      },
    });

    if (!membership || membership.role !== 'ORG_ADMIN') {
      throw new AppError('FORBIDDEN', 'Only campus administrators can delete campus locations.');
    }

    await prisma.campusLocation.delete({
      where: { id },
    });

    // Immutable audit log
    await prisma.auditEvent.create({
      data: {
        organizationId: existingLocation.organizationId,
        actorId: user.id,
        action: 'CAMPUS_LOCATION_DELETED',
        entityType: 'CAMPUS_LOCATION',
        entityId: id,
        metadata: {
          name: existingLocation.name,
          area: existingLocation.area,
        },
      },
    });

    return successResponse({ id, deleted: true });
  } catch (err) {
    return errorResponse(err);
  }
}

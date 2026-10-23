import { NextRequest } from 'next/server';
import prisma from '@/src/db';
import { requireAuth, getSessionUser } from '@/src/auth';
import { successResponse, errorResponse } from '@/src/lib/response';
import { AppError } from '@/src/lib/errors';
import { z } from 'zod';

const FALLBACK_CMRIT_ZONES = [
  'Central Library & Reading Hall',
  'Food Court / Student Cafeteria',
  'Basic Science Block (BS-302 / Labs)',
  'Main Block (Aero / Mech / Physics)',
  'Civil & Electrical Block',
  'Sports Complex & Cricket Ground',
  'Kaveri / Main Auditorium',
  'Placement & Admin Block',
  'Hostel Block / Campus Gate',
];

const CreateLocationSchema = z.object({
  orgId: z.string().uuid('Invalid organization ID'),
  name: z.string().trim().min(2, 'Location name must be at least 2 characters').max(100, 'Location name cannot exceed 100 characters'),
  area: z.string().trim().max(100, 'Area name cannot exceed 100 characters').optional().nullable(),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().optional().default(0),
});

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get('orgId');
    const orgSlug = searchParams.get('orgSlug');
    const includeAll = searchParams.get('all') === 'true';

    let resolvedOrgId = orgId;
    if (!resolvedOrgId && orgSlug) {
      const org = await prisma.organization.findUnique({
        where: { slug: orgSlug },
        select: { id: true },
      });
      if (org) resolvedOrgId = org.id;
    }

    if (!resolvedOrgId) {
      // If no org specified, resolve the default CMRIT organization
      const defaultOrg = await prisma.organization.findUnique({
        where: { slug: 'cmrit-lost-and-found' },
        select: { id: true },
      });
      if (defaultOrg) resolvedOrgId = defaultOrg.id;
    }

    if (!resolvedOrgId) {
      // Return hardcoded fallback if no org in DB
      return successResponse(
        FALLBACK_CMRIT_ZONES.map((name, idx) => ({
          id: `fallback-${idx}`,
          name,
          area: name.split(' ')[0],
          isActive: true,
          sortOrder: idx + 1,
        }))
      );
    }

    // Determine if requester can view inactive locations
    let canViewInactive = false;
    if (includeAll) {
      const currentUser = await getSessionUser();
      if (currentUser) {
        const membership = await prisma.membership.findUnique({
          where: {
            organizationId_userId: {
              organizationId: resolvedOrgId,
              userId: currentUser.id,
            },
          },
        });
        if (membership && (membership.role === 'ORG_ADMIN' || membership.role === 'MODERATOR')) {
          canViewInactive = true;
        }
      }
    }

    const where: any = { organizationId: resolvedOrgId };
    if (!canViewInactive) {
      where.isActive = true;
    }

    let locations = await prisma.campusLocation.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    // If database has no locations for this org yet, seed defaults and return them
    if (locations.length === 0) {
      try {
        const seedBatch = FALLBACK_CMRIT_ZONES.map((name, idx) => ({
          organizationId: resolvedOrgId!,
          name,
          area: name.split(' ')[0],
          sortOrder: idx + 1,
          isActive: true,
        }));
        await prisma.campusLocation.createMany({
          data: seedBatch,
          skipDuplicates: true,
        });
        locations = await prisma.campusLocation.findMany({
          where,
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        });
      } catch {
        // Fallback to static in memory if DB write unavailable
        return successResponse(
          FALLBACK_CMRIT_ZONES.map((name, idx) => ({
            id: `fallback-${idx}`,
            name,
            area: name.split(' ')[0],
            isActive: true,
            sortOrder: idx + 1,
          }))
        );
      }
    }

    return successResponse(locations);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req);
    const body = await req.json().catch(() => null);

    const parsed = CreateLocationSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', parsed.error.issues[0]?.message || 'Invalid location data');
    }

    const { orgId, name, area, isActive, sortOrder } = parsed.data;

    // Authorization: User MUST be ORG_ADMIN of this organization
    const membership = await prisma.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: orgId,
          userId: user.id,
        },
      },
    });

    if (!membership || membership.role !== 'ORG_ADMIN') {
      throw new AppError('FORBIDDEN', 'Only campus administrators can add campus locations.');
    }

    const derivedArea = area && area.trim().length > 0 ? area.trim() : name.split(' ')[0];

    const newLocation = await prisma.campusLocation.create({
      data: {
        organizationId: orgId,
        name,
        area: derivedArea,
        isActive: isActive !== undefined ? isActive : true,
        sortOrder: sortOrder || 0,
      },
    });

    // Audit log
    await prisma.auditEvent.create({
      data: {
        organizationId: orgId,
        actorId: user.id,
        action: 'CAMPUS_LOCATION_CREATED',
        entityType: 'CAMPUS_LOCATION',
        entityId: newLocation.id,
        metadata: {
          name: newLocation.name,
          area: newLocation.area,
          sortOrder: newLocation.sortOrder,
          isActive: newLocation.isActive,
        },
      },
    });

    return successResponse(newLocation, 201);
  } catch (err) {
    return errorResponse(err);
  }
}

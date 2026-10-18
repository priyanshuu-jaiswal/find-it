import { NextRequest } from 'next/server';
import { requireAuth } from '@/src/auth';
import prisma from '@/src/db';
import { successResponse, errorResponse } from '@/src/lib/response';

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req);

    const memberships = await prisma.membership.findMany({
      where: { userId: user.id },
      include: {
        organization: true,
      },
      orderBy: { joinedAt: 'asc' },
    });

    return successResponse({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        createdAt: user.createdAt,
      },
      memberships: memberships.map((m) => ({
        orgId: m.organizationId,
        slug: m.organization.slug,
        name: m.organization.name,
        role: m.role,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

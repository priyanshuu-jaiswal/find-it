import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/src/db';
import { successResponse, errorResponse } from '@/src/lib/response';
import { AppError } from '@/src/lib/errors';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || !body.email || typeof body.email !== 'string') {
      throw new AppError('VALIDATION_ERROR', 'A valid email address is required');
    }

    const email = body.email.toLowerCase().trim();

    // Look up or provision user
    let user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      const localPart = email.split('@')[0];
      const displayName = localPart
        .split('.')
        .map((s: string) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(' ');

      user = await prisma.user.create({
        data: {
          email,
          displayName: `${displayName} (Student)`,
          authSubject: `credentials|${email}`,
        },
      });
    }

    if (user.disabledAt) {
      throw new AppError('FORBIDDEN', 'This user account has been disabled');
    }

    // Ensure organization membership in cmrit-lost-and-found
    const cmrit = await prisma.organization.findUnique({
      where: { slug: 'cmrit-lost-and-found' },
    });

    let role = 'MEMBER';
    if (cmrit) {
      const isModerator =
        body.moderatorCode === 'CMRIT_MOD_2026' ||
        email.includes('security') ||
        email.includes('moderator');

      role = isModerator ? 'MODERATOR' : 'MEMBER';

      await prisma.membership.upsert({
        where: {
          organizationId_userId: {
            organizationId: cmrit.id,
            userId: user.id,
          },
        },
        update: isModerator ? { role: 'MODERATOR' } : {},
        create: {
          organizationId: cmrit.id,
          userId: user.id,
          role: role as any,
        },
      });
    }

    const response = NextResponse.json({
      data: {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          role,
        },
      },
    });

    response.cookies.set('cmrit-session', user.email, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    return response;
  } catch (err) {
    return errorResponse(err);
  }
}

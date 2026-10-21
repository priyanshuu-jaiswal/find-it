import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/src/db';
import { errorResponse } from '@/src/lib/response';
import { AppError } from '@/src/lib/errors';
import { hashPassword, verifyPassword } from '@/src/lib/password';
import { MemberRole } from '@prisma/client';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || !body.email || typeof body.email !== 'string') {
      throw new AppError('VALIDATION_ERROR', 'A valid email address is required');
    }

    const email = body.email.toLowerCase().trim();
    const password = typeof body.password === 'string' ? body.password : '';
    const isAdminLogin = Boolean(body.isAdminLogin);
    const mode = body.mode === 'signup' ? 'signup' : 'signin';
    const displayNameInput = typeof body.displayName === 'string' ? body.displayName.trim() : '';

    // Enforce @cmrit.ac.in domain restriction
    if (!email.endsWith('@cmrit.ac.in')) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Access is restricted exclusively to official CMRIT accounts ending in @cmrit.ac.in'
      );
    }

    if (!password || password.length < 6) {
      throw new AppError('VALIDATION_ERROR', 'Password must be at least 6 characters');
    }

    // Resolve CMRIT organization
    const cmrit = await prisma.organization.findUnique({
      where: { slug: 'cmrit-lost-and-found' },
    });

    if (!cmrit) {
      throw new AppError('NOT_FOUND', 'CMRIT organization not found');
    }

    let user = await prisma.user.findUnique({
      where: { email },
    });

    // 1. ADMIN LOGIN FLOW
    if (isAdminLogin) {
      if (mode === 'signup') {
        throw new AppError('FORBIDDEN', 'Public admin registration is disabled. Contact campus IT.');
      }

      if (!user) {
        throw new AppError('UNAUTHENTICATED', 'Invalid admin email or password');
      }

      if (user.disabledAt) {
        throw new AppError('FORBIDDEN', 'This user account has been disabled');
      }

      const isValidPassword = verifyPassword(password, user.passwordHash);
      if (!isValidPassword) {
        throw new AppError('UNAUTHENTICATED', 'Invalid admin email or password');
      }

      // Check membership clearance in cmrit-lost-and-found
      const membership = await prisma.membership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: cmrit.id,
            userId: user.id,
          },
        },
      });

      if (!membership || (membership.role !== MemberRole.MODERATOR && membership.role !== MemberRole.ORG_ADMIN)) {
        throw new AppError('FORBIDDEN', 'Access Denied: Admin or Campus Security credentials required.');
      }

      const response = NextResponse.json({
        data: {
          user: {
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            role: membership.role,
          },
          redirectUrl: '/cmrit-lost-and-found/moderation',
        },
      });

      response.cookies.set('cmrit-session', user.email, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 30 * 24 * 60 * 60,
      });

      return response;
    }

    // 2. STUDENT & FACULTY FLOW
    if (mode === 'signup') {
      if (user && user.passwordHash) {
        throw new AppError(
          'CONFLICT',
          'An account with this email already exists. Please sign in instead.'
        );
      }

      const defaultName = email
        .split('@')[0]
        .split('.')
        .map((s: string) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(' ');

      const finalName = displayNameInput || defaultName;

      if (user) {
        // User exists without password (e.g. legacy), set password and update name
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            passwordHash: hashPassword(password),
            displayName: finalName,
          },
        });
      } else {
        user = await prisma.user.create({
          data: {
            email,
            displayName: finalName,
            passwordHash: hashPassword(password),
            authSubject: `credentials|${email}`,
          },
        });
      }

      // Ensure MEMBER role in cmrit-lost-and-found
      await prisma.membership.upsert({
        where: {
          organizationId_userId: {
            organizationId: cmrit.id,
            userId: user.id,
          },
        },
        update: {},
        create: {
          organizationId: cmrit.id,
          userId: user.id,
          role: MemberRole.MEMBER,
        },
      });

      const response = NextResponse.json({
        data: {
          user: {
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            role: MemberRole.MEMBER,
          },
          redirectUrl: '/cmrit-lost-and-found/reports',
        },
      });

      response.cookies.set('cmrit-session', user.email, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 30 * 24 * 60 * 60,
      });

      return response;
    }

    // mode === 'signin'
    if (!user) {
      throw new AppError(
        'UNAUTHENTICATED',
        'No account found with this email. Please switch to Sign Up to create your account.'
      );
    }

    if (user.disabledAt) {
      throw new AppError('FORBIDDEN', 'This user account has been disabled');
    }

    const isValidPassword = verifyPassword(password, user.passwordHash);
    if (!isValidPassword) {
      throw new AppError('UNAUTHENTICATED', 'Incorrect password. Please try again.');
    }

    // Ensure membership exists
    let membership = await prisma.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: cmrit.id,
          userId: user.id,
        },
      },
    });

    if (!membership) {
      membership = await prisma.membership.create({
        data: {
          organizationId: cmrit.id,
          userId: user.id,
          role: MemberRole.MEMBER,
        },
      });
    }

    const response = NextResponse.json({
      data: {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          role: membership.role,
        },
        redirectUrl: '/cmrit-lost-and-found/reports',
      },
    });

    response.cookies.set('cmrit-session', user.email, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    });

    return response;
  } catch (err) {
    return errorResponse(err);
  }
}

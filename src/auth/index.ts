import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import prisma from '@/src/db';
import { AppError } from '@/src/lib/errors';

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET,
  session: {
    strategy: 'jwt',
  },
  providers: [
    ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
      ? [
          Google({
            clientId: process.env.AUTH_GOOGLE_ID,
            clientSecret: process.env.AUTH_GOOGLE_SECRET,
          }),
        ]
      : []),
    Credentials({
      id: 'mock-credentials',
      name: 'Campus Dev Login',
      credentials: {
        email: { label: 'Email', type: 'email', placeholder: 'alice@apex.edu' },
      },
      async authorize(credentials) {
        if (!credentials?.email || typeof credentials.email !== 'string') {
          return null;
        }

        const email = credentials.email.toLowerCase().trim();
        const user = await prisma.user.findUnique({
          where: { email },
        });

        if (!user || user.disabledAt) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.displayName,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.email = user.email;
        token.name = user.name;
      }
      return token;
    },
    async session({ session, token }) {
      if (token?.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
});

export async function getSessionUser(req?: Request) {
  // 1. Check for test header or persona cookie in dev/test mode for rapid testing/Playwright/Demo
  if (process.env.NODE_ENV !== 'production') {
    let testEmail = req?.headers?.get?.('x-test-email');
    if (!testEmail && req && 'cookies' in req) {
      testEmail = (req as any).cookies?.get?.('findit-persona')?.value;
    }
    if (!testEmail && req?.headers?.get?.('cookie')) {
      const cookieHeader = req.headers.get('cookie') || '';
      const match = cookieHeader.match(/(?:^|;\s*)findit-persona=([^;]+)/);
      if (match) {
        testEmail = decodeURIComponent(match[1]);
      }
    }
    if (!testEmail) {
      try {
        const { cookies } = await import('next/headers');
        const cookieStore = await cookies();
        testEmail = cookieStore.get('findit-persona')?.value;
      } catch {
        // Outside Next.js request store context
      }
    }
    if (testEmail) {
      const user = await prisma.user.findUnique({
        where: { email: testEmail.toLowerCase().trim() },
      });
      if (user && !user.disabledAt) {
        return user;
      }
    }
  }

  // 2. Check standard NextAuth session
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return null;
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
    });

    if (!user || user.disabledAt) {
      return null;
    }

    return user;
  } catch {
    return null;
  }
}

export async function requireAuth(req?: Request) {
  const user = await getSessionUser(req);
  if (!user) {
    throw new AppError('UNAUTHENTICATED', 'Authentication required to access this resource');
  }
  return user;
}

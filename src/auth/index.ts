import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import prisma from '@/src/db';
import { AppError } from '@/src/lib/errors';
import { verifyPassword } from '@/src/lib/password';
import { verifySessionToken } from '@/src/lib/session';

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET,
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/login',
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
      id: 'credentials',
      name: 'CMRIT Campus Login',
      credentials: {
        email: { label: 'CMRIT Email', type: 'email', placeholder: 'arjun@cmrit.ac.in' },
        password: { label: 'Password', type: 'password' },
        moderatorCode: { label: 'Access Code', type: 'text' },
      },
      async authorize(credentials) {
        if (!credentials?.email || typeof credentials.email !== 'string') {
          return null;
        }

        const email = credentials.email.toLowerCase().trim();
        const password = typeof credentials.password === 'string' ? credentials.password : '';

        const user = await prisma.user.findUnique({
          where: { email },
        });

        if (!user || user.disabledAt) {
          return null;
        }

        if (user.passwordHash && !verifyPassword(password, user.passwordHash)) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.displayName,
        };
      },
    }),
    ...(process.env.NODE_ENV !== 'production'
      ? [
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
        ]
      : []),
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
  // 1. Check for test header (strictly restricted to automated test runs)
  if (process.env.NODE_ENV === 'test') {
    const testEmail = req?.headers?.get?.('x-test-email');
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
    if (session?.user?.id) {
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
      });
      if (user && !user.disabledAt) {
        return user;
      }
    }
    if (session?.user?.email) {
      const user = await prisma.user.findUnique({
        where: { email: session.user.email.toLowerCase().trim() },
      });
      if (user && !user.disabledAt) {
        return user;
      }
    }
  } catch {
    // NextAuth lookup failed or outside Next.js request store
  }

  // 3. Fallback: Check cryptographically signed cmrit-session cookie
  let rawSessionToken: string | undefined;

  if (req && 'cookies' in req) {
    rawSessionToken = (req as any).cookies?.get?.('cmrit-session')?.value;
  }

  if (!rawSessionToken && req?.headers?.get?.('cookie')) {
    const cookieHeader = req.headers.get('cookie') || '';
    const match = cookieHeader.match(/(?:^|;\s*)cmrit-session=([^;]+)/);
    if (match) {
      rawSessionToken = decodeURIComponent(match[1]);
    }
  }

  if (!rawSessionToken) {
    try {
      const { cookies } = await import('next/headers');
      const cookieStore = await cookies();
      rawSessionToken = cookieStore.get('cmrit-session')?.value;
    } catch {
      // Outside Next.js headers store context
    }
  }

  if (rawSessionToken) {
    const verifiedEmail = verifySessionToken(rawSessionToken);
    if (verifiedEmail) {
      const user = await prisma.user.findUnique({
        where: { email: verifiedEmail },
      });
      if (user && !user.disabledAt) {
        return user;
      }
    }
  }

  return null;
}

export async function requireAuth(req?: Request) {
  const user = await getSessionUser(req);
  if (!user) {
    throw new AppError('UNAUTHENTICATED', 'Authentication required to access this resource');
  }
  return user;
}

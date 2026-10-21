import { redirect } from 'next/navigation';
import { getSessionUser } from '@/src/auth';
import prisma from '@/src/db';
import { MemberRole } from '@prisma/client';

export default async function RootHomePage() {
  const user = await getSessionUser();

  if (!user) {
    redirect('/login');
  }

  // Check if user is moderator/admin in cmrit-lost-and-found
  const cmrit = await prisma.organization.findUnique({
    where: { slug: 'cmrit-lost-and-found' },
  });

  if (cmrit) {
    const membership = await prisma.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: cmrit.id,
          userId: user.id,
        },
      },
    });

    if (membership && (membership.role === MemberRole.MODERATOR || membership.role === MemberRole.ORG_ADMIN)) {
      redirect('/cmrit-lost-and-found/moderation');
    }
  }

  redirect('/cmrit-lost-and-found/reports');
}

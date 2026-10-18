import React from 'react';
import { notFound } from 'next/navigation';
import prisma from '@/src/db';
import { getSessionUser } from '@/src/auth';
import { PersonaBanner } from '@/src/components/layout/persona-banner';
import { TopNavbar } from '@/src/components/layout/top-navbar';

interface OrgLayoutProps {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}

export default async function OrgLayout({ children, params }: OrgLayoutProps) {
  const { orgSlug } = await params;

  // 1. Resolve organization (strict isolation)
  const org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
  });

  if (!org) {
    notFound();
  }

  // 2. Resolve current user & role
  const user = await getSessionUser();
  let userRole = 'MEMBER';

  if (user) {
    const membership = await prisma.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: org.id,
          userId: user.id,
        },
      },
    });
    if (membership) {
      userRole = membership.role;
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Sleek top-banner for instant local persona switching */}
      <PersonaBanner />

      <TopNavbar
        orgSlug={orgSlug}
        currentUser={
          user
            ? {
                displayName: user.displayName,
                email: user.email,
                role: userRole,
              }
            : undefined
        }
      />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>
    </div>
  );
}

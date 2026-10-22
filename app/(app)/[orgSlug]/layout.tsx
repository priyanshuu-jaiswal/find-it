import React from 'react';
import { notFound, redirect } from 'next/navigation';
import prisma from '@/src/db';
import { getSessionUser } from '@/src/auth';
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

  // 2. Resolve current user & role (Strict Authentication Gate)
  const user = await getSessionUser();
  if (!user) {
    redirect('/login');
  }

  let userRole = 'MEMBER';
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

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <TopNavbar
        orgSlug={orgSlug}
        currentUser={{
          displayName: user.displayName,
          email: user.email,
          role: userRole,
        }}
      />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 pb-20 md:pb-6">
        {children}
      </main>
    </div>
  );
}

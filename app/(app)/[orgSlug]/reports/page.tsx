import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import prisma from '@/src/db';
import { getSessionUser } from '@/src/auth';
import { ReportCard, ReportItem } from '@/src/components/reports/report-card';
import { ReportFilterBar } from '@/src/components/reports/report-filter-bar';
import { PlusIcon } from '@/src/components/ui/icons';

interface ReportsPageProps {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{
    type?: string;
    category?: string;
    q?: string;
    locationArea?: string;
  }>;
}

export default async function ReportsPage({ params, searchParams }: ReportsPageProps) {
  const { orgSlug } = await params;
  const { type, category, q, locationArea } = await searchParams;

  const org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
  });

  if (!org) {
    notFound();
  }

  const currentUser = await getSessionUser();

  // Build query filters (only active OPEN reports appear in the discovery feed)
  const where: any = {
    organizationId: org.id,
    status: 'OPEN',
  };

  const effectiveType = type ? type : 'FOUND';
  if (effectiveType === 'LOST' || effectiveType === 'FOUND') {
    where.type = effectiveType;
  }

  if (category) {
    where.category = category;
  }

  if (locationArea) {
    where.locationArea = { contains: locationArea, mode: 'insensitive' };
  }

  if (q) {
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
      { brand: { contains: q, mode: 'insensitive' } },
      { locationLabel: { contains: q, mode: 'insensitive' } },
    ];
  }

  const reports = await prisma.report.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      images: {
        where: { status: { in: ['READY', 'PROCESSING'] } },
        orderBy: { createdAt: 'asc' },
      },
      claims: {
        select: { id: true, status: true },
      },
      lostMatches: {
        select: { id: true },
      },
      foundMatches: {
        select: { id: true },
      },
    },
    take: 50,
  });

  const formattedReports: ReportItem[] = reports.map((r) => {
    const isOwner = currentUser ? r.ownerId === currentUser.id : false;
    const matchesCount = r.type === 'LOST' ? r.lostMatches.length : r.foundMatches.length;

    return {
      id: r.id,
      type: r.type as 'LOST' | 'FOUND',
      status: r.status as any,
      category: r.category,
      title: r.title,
      description: r.description,
      brand: r.brand,
      color: r.color,
      locationLabel: r.locationLabel,
      locationArea: r.locationArea,
      createdAt: r.createdAt.toISOString(),
      ownerId: r.ownerId,
      images: r.images.map((img) => ({
        id: img.id,
        url: `/api/v1/images/${img.id}`,
        status: img.status as any,
      })),
      claimsCount: r.claims.length,
      matchesCount,
      isOwner,
    };
  });

  return (
    <div className="space-y-6">
      {/* Action Cards: I Found Something vs. I Lost Something */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Card 1: Green Accent - I Found an Item */}
        <div className="bg-gradient-to-br from-emerald-950 via-slate-900 to-slate-900 text-white p-6 sm:p-7 rounded-3xl border border-emerald-800/40 shadow-sm flex flex-col justify-between space-y-4">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 mb-3">
              <span>🎁 Campus Finder</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-white">
              I Found an Item on Campus
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 mt-2 leading-relaxed">
              Post the item details and photo in the Found section so the owner can claim it.
            </p>
          </div>

          <div>
            <Link
              href={`/${orgSlug}/reports/new?type=FOUND`}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs sm:text-sm shadow-md transition cursor-pointer w-full sm:w-auto"
            >
              <span>Post a Found Item →</span>
            </Link>
          </div>
        </div>

        {/* Card 2: Indigo/Rose Accent - I Lost an Item */}
        <div className="bg-gradient-to-br from-indigo-950 via-slate-900 to-slate-900 text-white p-6 sm:p-7 rounded-3xl border border-indigo-800/40 shadow-sm flex flex-col justify-between space-y-4">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 mb-3">
              <span>🔍 Lost Property</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-white">
              I Lost an Item
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 mt-2 leading-relaxed">
              Browse the Found Items list below to claim your item, or post a Lost Alert if it hasn&apos;t been turned in yet.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <Link
              href={`/${orgSlug}/reports?type=FOUND`}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs border border-slate-700 shadow-sm transition cursor-pointer"
            >
              <span>Browse Found Items Below ↓</span>
            </Link>
            <Link
              href={`/${orgSlug}/reports/new?type=LOST`}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md transition cursor-pointer"
            >
              <span>Post a Lost Alert</span>
            </Link>
          </div>
        </div>
      </div>

      {/* How It Works Guidance Banner */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-4 bg-slate-50 border border-slate-200/80 rounded-2xl">
        <div className="flex items-start gap-3 p-2">
          <div className="w-7 h-7 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold shrink-0">
            1
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900">Post or Browse</h4>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
              Report a lost item or post property you found on campus with photo and zone.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 p-2">
          <div className="w-7 h-7 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold shrink-0">
            2
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900">Instant Matching</h4>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
              Our deterministic scoring engine computes candidate matches in real time.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 p-2">
          <div className="w-7 h-7 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold shrink-0">
            3
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900">Claim & Secure Return</h4>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
              Submit proof, unlock gated handoff chat upon approval, and confirm safe return.
            </p>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <ReportFilterBar />

      {/* Listings Grid */}
      {formattedReports.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200/80 p-12 text-center flex flex-col items-center justify-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center text-3xl mb-4">
            🔍
          </div>
          <h3 className="text-base font-bold text-slate-900">No items found</h3>
          <p className="text-xs text-slate-500 max-w-sm mt-1 leading-relaxed">
            No active reports match your current search or category filters. Try resetting filters or post a new item.
          </p>
          <Link
            href={`/${orgSlug}/reports/new`}
            className="mt-5 inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition"
          >
            <PlusIcon className="w-4 h-4" />
            <span>Post New Report</span>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {formattedReports.map((report) => (
            <ReportCard key={report.id} report={report} orgSlug={orgSlug} />
          ))}
        </div>
      )}
    </div>
  );
}

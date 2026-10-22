'use client';

import React from 'react';
import Link from 'next/link';
import { MapPinIcon, LockIcon, SparklesIcon, TagIcon, ClockIcon } from '../ui/icons';

export interface ReportItem {
  id: string;
  type: 'LOST' | 'FOUND';
  status: 'OPEN' | 'RESOLVED' | 'WITHDRAWN' | 'EXPIRED' | 'HIDDEN';
  category: string;
  title: string;
  description: string;
  color?: string | null;
  brand?: string | null;
  locationLabel: string;
  locationArea?: string | null;
  createdAt: string;
  ownerId?: string;
  images?: Array<{
    id: string;
    url?: string;
    status: 'PENDING_UPLOAD' | 'PROCESSING' | 'READY' | 'REJECTED';
  }>;
  claimsCount?: number;
  matchesCount?: number;
  isOwner?: boolean;
}

interface ReportCardProps {
  report: ReportItem;
  orgSlug: string;
}

function timeAgo(dateString: string): string {
  const diff = Date.now() - new Date(dateString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ReportCard({ report, orgSlug }: ReportCardProps) {
  const isLost = report.type === 'LOST';
  const firstImage = report.images && report.images.length > 0 ? report.images[0] : null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs hover:shadow-md transition-all overflow-hidden flex flex-col group">
      {/* Visual Header / Image area */}
      <div className="relative aspect-16/10 bg-slate-100 overflow-hidden flex items-center justify-center border-b border-slate-100">
        {firstImage?.status === 'READY' && firstImage.url ? (
          <img
            src={firstImage.url}
            alt={report.title}
            className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-300"
          />
        ) : firstImage?.status === 'PROCESSING' ? (
          <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 text-white p-4 text-center">
            <LockIcon className="w-5 h-5 text-indigo-400 mb-2 animate-bounce" />
            <span className="text-xs font-semibold text-slate-200">
              🔒 Sanitizing EXIF & GPS...
            </span>
            <span className="text-[10px] text-slate-400 mt-1">Generating safe WebP</span>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center text-slate-400">
            <span className="text-2xl mb-1">
              {report.category === 'Electronics' ? '💻' : report.category === 'Bags' ? '🎒' : '📦'}
            </span>
            <span className="text-xs font-medium text-slate-400">{report.category}</span>
          </div>
        )}

        {/* Status badges */}
        <div className="absolute top-3 left-3 flex items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wide uppercase shadow-xs ${
              isLost
                ? 'bg-rose-50/95 text-rose-700 border border-rose-200/80 backdrop-blur-xs'
                : 'bg-emerald-50/95 text-emerald-700 border border-emerald-200/80 backdrop-blur-xs'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${isLost ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'}`}
            />
            {report.type}
          </span>

          {report.status !== 'OPEN' && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-slate-900/80 text-white backdrop-blur-xs">
              {report.status}
            </span>
          )}
        </div>

        {/* Location badge */}
        <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-slate-900/80 text-slate-100 backdrop-blur-md truncate max-w-[80%]">
            <MapPinIcon className="w-3 h-3 text-slate-300 shrink-0" />
            <span className="truncate">{report.locationLabel}</span>
          </span>
          <span
            suppressHydrationWarning
            className="text-[10px] font-medium text-slate-100/90 bg-slate-900/60 px-2 py-1 rounded-md backdrop-blur-md"
          >
            {timeAgo(report.createdAt)}
          </span>
        </div>
      </div>

      {/* Content Area */}
      <div className="p-4 flex-1 flex flex-col justify-between">
        <div>
          <Link href={`/${orgSlug}/reports/${report.id}`} className="block group-hover:text-indigo-600 transition-colors">
            <h3 className="font-bold text-slate-900 text-sm leading-snug line-clamp-1">
              {report.title}
            </h3>
          </Link>
          <p className="text-xs text-slate-500 mt-1.5 line-clamp-2 leading-relaxed">
            {report.description}
          </p>
        </div>

        {/* Tags & Action row */}
        <div className="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 flex-wrap">
            {report.brand && (
              <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 text-slate-700 border border-slate-200/60">
                {report.brand}
              </span>
            )}
            {report.color && (
              <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 text-slate-700 border border-slate-200/60">
                {report.color}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {report.isOwner && report.matchesCount !== undefined && report.matchesCount > 0 && (
              <Link
                href={`/${orgSlug}/reports/${report.id}?tab=matches`}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition"
              >
                <SparklesIcon className="w-3 h-3 text-indigo-600" />
                <span>{report.matchesCount} Matches</span>
              </Link>
            )}

            <Link
              href={`/${orgSlug}/reports/${report.id}`}
              className="text-xs font-semibold text-slate-600 hover:text-slate-900"
            >
              Details →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

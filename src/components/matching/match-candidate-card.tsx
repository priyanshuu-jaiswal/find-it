'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ThumbsUpIcon, ThumbsDownIcon, CheckCircleIcon } from '../ui/icons';

export interface MatchCandidate {
  id: string;
  score: number;
  reasons: string[];
  report: {
    id: string;
    type: 'LOST' | 'FOUND';
    title: string;
    description: string;
    category: string;
    brand?: string | null;
    color?: string | null;
    locationLabel: string;
    createdAt: string;
    images?: Array<{ id: string; url?: string }>;
  };
}

interface MatchCandidateCardProps {
  match: MatchCandidate;
  orgSlug: string;
  onDismiss?: (matchId: string) => void;
}

export function MatchCandidateCard({ match, orgSlug, onDismiss }: MatchCandidateCardProps) {
  const [feedback, setFeedback] = useState<'useful' | 'dismissed' | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const scorePercent = Math.round(match.score * 100);

  const handleFeedback = async (useful: boolean) => {
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/v1/matches/${match.id}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ useful, dismissed: !useful }),
      });
      if (res.ok) {
        setFeedback(useful ? 'useful' : 'dismissed');
        if (!useful && onDismiss) {
          setTimeout(() => onDismiss(match.id), 300);
        }
      }
    } catch {
      // Ignore
    } finally {
      setIsSubmitting(false);
    }
  };

  if (feedback === 'dismissed') {
    return null;
  }

  const firstImage = match.report.images && match.report.images.length > 0 ? match.report.images[0] : null;

  return (
    <div className="bg-white rounded-2xl border border-indigo-100 shadow-xs hover:border-indigo-300 transition p-4">
      <div className="flex items-start justify-between gap-3">
        {/* Thumbnail & Title */}
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {firstImage?.url ? (
            <img
              src={firstImage.url}
              alt={match.report.title}
              className="w-14 h-14 rounded-xl object-cover border border-slate-200 shrink-0"
            />
          ) : (
            <div className="w-14 h-14 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-lg shrink-0">
              📦
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${
                  match.report.type === 'LOST'
                    ? 'bg-rose-50 text-rose-700 border border-rose-200'
                    : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                }`}
              >
                {match.report.type}
              </span>
              <span className="text-xs text-slate-400 truncate">
                {match.report.locationLabel}
              </span>
            </div>

            <Link
              href={`/${orgSlug}/reports/${match.report.id}`}
              className="font-bold text-slate-900 text-sm hover:text-indigo-600 transition block mt-0.5 truncate"
            >
              {match.report.title}
            </Link>
            <p className="text-xs text-slate-500 line-clamp-1 mt-0.5">
              {match.report.description}
            </p>
          </div>
        </div>

        {/* High-Contrast Match Score Pill */}
        <div className="px-2.5 py-1 rounded-full bg-indigo-600 text-white text-xs font-black tracking-wide shrink-0 shadow-xs">
          {scorePercent}% Match
        </div>
      </div>

      {/* Concise Checkmark Reason Chips */}
      {match.reasons && match.reasons.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 pt-2.5 border-t border-slate-100">
          {match.reasons.map((reason, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200/60"
            >
              <CheckCircleIcon className="w-3 h-3 text-indigo-600" />
              {reason}
            </span>
          ))}
        </div>
      )}

      {/* Action Row */}
      <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleFeedback(true)}
            disabled={isSubmitting || feedback === 'useful'}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
              feedback === 'useful'
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            <ThumbsUpIcon className="w-3 h-3" />
            <span>{feedback === 'useful' ? 'Useful' : 'Mark Useful'}</span>
          </button>

          <button
            onClick={() => handleFeedback(false)}
            disabled={isSubmitting}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-rose-50 hover:text-rose-700 text-slate-600 transition cursor-pointer"
          >
            <ThumbsDownIcon className="w-3 h-3" />
            <span>Dismiss</span>
          </button>
        </div>

        <Link
          href={`/${orgSlug}/reports/${match.report.id}`}
          className="text-xs font-bold text-indigo-600 hover:text-indigo-800"
        >
          View & Claim This Match →
        </Link>
      </div>
    </div>
  );
}

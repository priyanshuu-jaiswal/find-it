'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { PresignedDropzone } from '@/src/components/reports/presigned-dropzone';
import { ShieldIcon, ArrowRightIcon, CheckCircleIcon, AlertTriangleIcon } from '@/src/components/ui/icons';

const CATEGORIES = [
  'Electronics',
  'Bags',
  'Documents',
  'Accessories',
  'Clothing',
];

const CAMPUS_LOCATIONS = [
  'Main Library 1st Floor Lobby',
  'Main Library 3rd Floor Study Lounge',
  'Student Union Food Court',
  'Engineering Hall Room 204',
  'Campus Recreation Center Locker Room',
  'Science Complex Lecture Hall B',
  'University Dining Hall West',
  'North Campus Bus Terminal',
];

export default function NewReportPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = (params?.orgSlug as string) || 'apex-university';

  const [orgId, setOrgId] = useState<string>('');
  const [type, setType] = useState<'LOST' | 'FOUND'>('LOST');
  const [category, setCategory] = useState<string>('Electronics');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [brand, setBrand] = useState('');
  const [color, setColor] = useState('');
  const [locationLabel, setLocationLabel] = useState(CAMPUS_LOCATIONS[0]);
  const [imageIds, setImageIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Resolve orgId from /api/v1/me
  useEffect(() => {
    fetch('/api/v1/me')
      .then((res) => res.json())
      .then((data) => {
        if (data.data?.memberships && data.data.memberships.length > 0) {
          const m = data.data.memberships.find((mem: any) => mem.slug === orgSlug) || data.data.memberships[0];
          setOrgId(m.id);
        }
      })
      .catch(() => {});
  }, [orgSlug]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) {
      setErrorMessage('Organization context not ready. Please refresh.');
      return;
    }

    if (title.length < 3) {
      setErrorMessage('Title must be at least 3 characters.');
      return;
    }

    if (description.length < 10) {
      setErrorMessage('Description must be at least 10 characters.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/v1/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          type,
          category,
          title: title.trim(),
          description: description.trim(),
          brand: brand.trim() || undefined,
          color: color.trim() || undefined,
          locationLabel,
          locationArea: locationLabel.split(' ')[0],
          imageIds,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || 'Failed to submit report');
      }

      const reportId = json.data.id;

      // Automatically trigger background worker in dev/demo mode
      fetch('/api/v1/internal/worker/tick', {
        method: 'POST',
        headers: { authorization: 'Bearer findit-worker-dev-secret' },
      }).catch(() => {});

      // Redirect to report detail with matches tab
      router.push(`/${orgSlug}/reports/${reportId}?tab=matches`);
    } catch (err: any) {
      setErrorMessage(err.message || 'An error occurred while creating the report.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto py-4">
      {/* Back button */}
      <div className="mb-4">
        <Link
          href={`/${orgSlug}/reports`}
          className="text-xs font-semibold text-slate-500 hover:text-slate-800 transition"
        >
          ← Back to Discovery Feed
        </Link>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
        {/* Header */}
        <div className="p-6 sm:p-8 border-b border-slate-100 bg-slate-50/50">
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
            Create Campus Report
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Fill in details to post your listing. Matches will be calculated automatically against existing campus property.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-6">
          {/* Step 1: Report Type Toggle */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
              1. What are you reporting?
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setType('LOST')}
                className={`p-4 rounded-2xl border text-left transition flex flex-col justify-between ${
                  type === 'LOST'
                    ? 'bg-rose-50/80 border-rose-300 ring-2 ring-rose-500/20 shadow-xs'
                    : 'bg-slate-50/60 border-slate-200 hover:bg-slate-100/60 text-slate-600'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-2xl">🔍</span>
                  <span
                    className={`w-2 h-2 rounded-full ${
                      type === 'LOST' ? 'bg-rose-500 animate-pulse' : 'bg-slate-300'
                    }`}
                  />
                </div>
                <div className="mt-2">
                  <span className="font-extrabold text-sm text-slate-900 block">
                    I Lost Something
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Search campus property and get notified of matches.
                  </span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setType('FOUND')}
                className={`p-4 rounded-2xl border text-left transition flex flex-col justify-between ${
                  type === 'FOUND'
                    ? 'bg-emerald-50/80 border-emerald-300 ring-2 ring-emerald-500/20 shadow-xs'
                    : 'bg-slate-50/60 border-slate-200 hover:bg-slate-100/60 text-slate-600'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-2xl">📦</span>
                  <span
                    className={`w-2 h-2 rounded-full ${
                      type === 'FOUND' ? 'bg-emerald-500' : 'bg-slate-300'
                    }`}
                  />
                </div>
                <div className="mt-2">
                  <span className="font-extrabold text-sm text-slate-900 block">
                    I Found Something
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Help reunite an item with its verified owner.
                  </span>
                </div>
              </button>
            </div>

            {/* Found Item Privacy Tip */}
            {type === 'FOUND' && (
              <div className="mt-3 p-3.5 bg-amber-50 rounded-2xl border border-amber-200/80 text-xs text-amber-800 flex items-start gap-2.5">
                <AlertTriangleIcon className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <strong className="font-semibold block text-amber-900">Verification Tip:</strong>
                  Keep one distinguishing detail (such as a lockscreen photo, hidden scratch, keychain, or serial number) out of the description. True claimants can use this to prove ownership.
                </div>
              </div>
            )}
          </div>

          {/* Step 2: Photo Upload */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
              2. Upload Photo (Optional)
            </label>
            {orgId ? (
              <PresignedDropzone
                orgId={orgId}
                onUploadSuccess={(id) => setImageIds([id])}
                onClear={() => setImageIds([])}
              />
            ) : (
              <div className="p-4 bg-slate-50 text-xs text-slate-400 rounded-2xl border border-slate-200 text-center">
                Loading campus storage credentials...
              </div>
            )}
          </div>

          {/* Step 3: Structured Details */}
          <div className="space-y-4">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
              3. Item Details & Coarse Location
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Category *
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full text-xs py-2.5 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-medium"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Coarse Campus Location *
                </label>
                <select
                  value={locationLabel}
                  onChange={(e) => setLocationLabel(e.target.value)}
                  className="w-full text-xs py-2.5 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-medium"
                >
                  {CAMPUS_LOCATIONS.map((loc) => (
                    <option key={loc} value={loc}>
                      {loc}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Report Title * (3–100 chars)
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Silver MacBook Air M2 in black sleeve"
                className="w-full text-xs py-2.5 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Brand (Optional)
                </label>
                <input
                  type="text"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  placeholder="e.g. Apple, Sony, Nike"
                  className="w-full text-xs py-2.5 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Primary Color (Optional)
                </label>
                <input
                  type="text"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  placeholder="e.g. Silver, Black, Navy"
                  className="w-full text-xs py-2.5 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Detailed Description * (10–3000 chars)
              </label>
              <textarea
                rows={4}
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Provide helpful context like stickers, markings, approximate time, and where you last had or saw the item..."
                className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 leading-relaxed"
              />
            </div>
          </div>

          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-medium">
              {errorMessage}
            </div>
          )}

          {/* Submit CTA */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
            <Link
              href={`/${orgSlug}/reports`}
              className="px-4 py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-800"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition shadow-sm cursor-pointer"
            >
              {isSubmitting ? (
                'Publishing Report...'
              ) : (
                <>
                  <span>Publish Report</span>
                  <ArrowRightIcon className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

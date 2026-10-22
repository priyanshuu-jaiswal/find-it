'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { PresignedDropzone } from '@/src/components/reports/presigned-dropzone';
import { ShieldIcon, ArrowRightIcon, AlertTriangleIcon } from '@/src/components/ui/icons';

const CATEGORIES = [
  'Electronics',
  'Documents',
  'Bags',
  'Stationery & Books',
  'Accessories',
  'Clothing',
  'Keys',
];

const CMRIT_ZONES = [
  'Central Library & Reading Hall',
  'Food Court / Student Cafeteria',
  'Basic Science Block (BS-302 / Labs)',
  'Main Block (Aero / Mech / Physics)',
  'Civil & Electrical Block',
  'Sports Complex & Cricket Ground',
  'Kaveri / Main Auditorium',
  'Placement & Admin Block',
  'Hostel Block / Campus Gate',
];

function NewReportForm() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const orgSlug = (params?.orgSlug as string) || 'cmrit-lost-and-found';

  const queryType = searchParams?.get('type');
  const initialType: 'LOST' | 'FOUND' = queryType === 'FOUND' ? 'FOUND' : 'LOST';

  const [orgId, setOrgId] = useState<string>('');
  const [type, setType] = useState<'LOST' | 'FOUND'>(initialType);
  const [category, setCategory] = useState<string>('Electronics');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [brand, setBrand] = useState('');
  const [color, setColor] = useState('');
  const [locationLabel, setLocationLabel] = useState(CMRIT_ZONES[0]);
  const [imageIds, setImageIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/me')
      .then((res) => res.json())
      .then((data) => {
        if (data.data?.memberships && data.data.memberships.length > 0) {
          const m = data.data.memberships.find((mem: any) => mem.slug === orgSlug) || data.data.memberships[0];
          setOrgId(m?.orgId ?? m?.id ?? '');
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

      router.push(`/${orgSlug}/reports/${reportId}?tab=matches`);
    } catch (err: any) {
      setErrorMessage(err.message || 'An error occurred while creating the report.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-2">
      {/* Header bar */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <Link
            href={`/${orgSlug}/reports`}
            className="text-xs font-semibold text-slate-500 hover:text-slate-800 transition block mb-1"
          >
            ← Back to CMRIT Discovery Feed
          </Link>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Post an Item to CMRIT Lost & Found
          </h1>
        </div>

        {/* Type toggle */}
        <div className="inline-flex p-1 bg-slate-200/80 rounded-xl text-xs font-bold shrink-0">
          <button
            type="button"
            onClick={() => setType('LOST')}
            className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
              type === 'LOST'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-white" />
            I Lost Something
          </button>
          <button
            type="button"
            onClick={() => setType('FOUND')}
            className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
              type === 'FOUND'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-white" />
            I Found Something
          </button>
        </div>
      </div>

      {type === 'FOUND' && (
        <div className="mb-4 p-3 bg-amber-50 rounded-xl border border-amber-200/80 text-xs text-amber-800 flex items-center gap-2">
          <AlertTriangleIcon className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            <strong>Verification Tip:</strong> Keep one distinguishing detail (such as sticker, serial number, or keychain) out of the description so true owners can prove ownership.
          </span>
        </div>
      )}

      {/* Flattened 2-Column Form */}
      <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-12 gap-5">
        {/* Left Column (5 cols): Photo & S3 Dropzone */}
        <div className="md:col-span-5 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
              Section 1 • Item Photo
            </h3>
            <p className="text-xs text-slate-500">
              Attach a clear photo. EXIF and GPS metadata will be stripped automatically.
            </p>
          </div>

          {orgId ? (
            <PresignedDropzone
              orgId={orgId}
              onUploadSuccess={(id) => setImageIds([id])}
              onClear={() => setImageIds([])}
            />
          ) : (
            <div className="p-4 bg-slate-50 text-xs text-slate-400 rounded-xl border border-slate-200 text-center">
              Connecting to CMRIT storage...
            </div>
          )}

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-[11px] text-slate-500 space-y-1">
            <span className="font-semibold text-slate-700 block">Automatic Matching:</span>
            <span>
              Once posted, the deterministic engine ranks candidates across CMRIT campus using title, brand, category, and zone proximity.
            </span>
          </div>
        </div>

        {/* Right Column (7 cols): Structured Attributes */}
        <div className="md:col-span-7 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-3.5">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
              Section 2 • Item Details & Campus Zone
            </h3>
            <p className="text-xs text-slate-500">
              Provide specific item characteristics to help matching algorithms locate candidates.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Category *
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full text-xs py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-medium"
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
                CMRIT Campus Zone *
              </label>
              <select
                value={locationLabel}
                onChange={(e) => setLocationLabel(e.target.value)}
                className="w-full text-xs py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-medium"
              >
                {CMRIT_ZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Title * (e.g. Casio Scientific Calculator, Boat Earbuds)
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Casio fx-991CW Calculator"
              className="w-full text-xs py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
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
                placeholder="e.g. Casio, Boat, Apple"
                className="w-full text-xs py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Color (Optional)
              </label>
              <input
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="e.g. Black, Blue, Silver"
                className="w-full text-xs py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Detailed Description *
            </label>
            <textarea
              rows={3}
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Where was it seen or left? Any identifiable markings, scratches, or pouch details..."
              className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 leading-relaxed"
            />
          </div>

          {errorMessage && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-medium">
              {errorMessage}
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-2.5">
            <Link
              href={`/${orgSlug}/reports`}
              className="px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-1.5 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition shadow-xs cursor-pointer"
            >
              {isSubmitting ? (
                'Publishing...'
              ) : (
                <>
                  <span>Publish Item</span>
                  <ArrowRightIcon className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export default function NewReportPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-4xl mx-auto py-12 text-center text-xs text-slate-400">
          Loading report form...
        </div>
      }
    >
      <NewReportForm />
    </Suspense>
  );
}

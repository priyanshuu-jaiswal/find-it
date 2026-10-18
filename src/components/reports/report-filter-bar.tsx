'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { SearchIcon } from '../ui/icons';

const CATEGORIES = [
  'All Categories',
  'Electronics',
  'Documents',
  'Bags',
  'Stationery & Books',
  'Accessories',
  'Clothing',
  'Keys',
];

export function ReportFilterBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentType = searchParams.get('type') || '';
  const currentCategory = searchParams.get('category') || '';
  const currentQuery = searchParams.get('q') || '';

  const [searchVal, setSearchVal] = useState(currentQuery);

  useEffect(() => {
    setSearchVal(currentQuery);
  }, [currentQuery]);

  const updateParams = (newType?: string, newCat?: string, newQ?: string) => {
    const params = new URLSearchParams(searchParams.toString());

    const t = newType !== undefined ? newType : currentType;
    const c = newCat !== undefined ? newCat : currentCategory;
    const q = newQ !== undefined ? newQ : currentQuery;

    if (t) params.set('type', t); else params.delete('type');
    if (c && c !== 'All Categories') params.set('category', c); else params.delete('category');
    if (q) params.set('q', q); else params.delete('q');

    router.push(`${pathname}?${params.toString()}`);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateParams(undefined, undefined, searchVal.trim());
  };

  return (
    <div className="bg-white p-2.5 sm:p-3 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
      {/* Left: Segmented [ All | Lost | Found ] Pill Toggle */}
      <div className="inline-flex p-1 bg-slate-100 rounded-xl border border-slate-200/60 shrink-0">
        <button
          onClick={() => updateParams('')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
            currentType === ''
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          All Items
        </button>
        <button
          onClick={() => updateParams('LOST')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
            currentType === 'LOST'
              ? 'bg-white text-rose-700 shadow-xs'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
          Lost
        </button>
        <button
          onClick={() => updateParams('FOUND')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
            currentType === 'FOUND'
              ? 'bg-white text-emerald-700 shadow-xs'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          Found
        </button>
      </div>

      {/* Right: Combined Search Input + Category Select */}
      <div className="flex items-center gap-2 flex-1 max-w-xl">
        <form onSubmit={handleSearchSubmit} className="relative flex-1">
          <SearchIcon className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchVal}
            onChange={(e) => setSearchVal(e.target.value)}
            onBlur={() => updateParams(undefined, undefined, searchVal.trim())}
            placeholder="Search items, brands, locations (e.g. calculator, ID card)..."
            className="w-full pl-8 pr-10 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800 placeholder:text-slate-400"
          />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] font-mono text-slate-400 border border-slate-200 px-1 py-0.2 rounded">
            ⌘K
          </span>
        </form>

        <select
          value={currentCategory || 'All Categories'}
          onChange={(e) => updateParams(undefined, e.target.value)}
          className="text-xs py-1.5 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-700 font-medium shrink-0 cursor-pointer"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

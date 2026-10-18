'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { SearchIcon, MapPinIcon } from '../ui/icons';

const CATEGORIES = [
  'All',
  'Electronics',
  'Bags',
  'Documents',
  'Accessories',
  'Clothing',
];

const CAMPUS_ZONES = [
  { value: '', label: 'All Campus Locations' },
  { value: 'Main Library', label: 'Main Library' },
  { value: 'Student Union', label: 'Student Union' },
  { value: 'Engineering Hall', label: 'Engineering Hall' },
  { value: 'Science Complex', label: 'Science Complex' },
  { value: 'Recreation Center', label: 'Campus Rec Center' },
  { value: 'Dining Hall', label: 'Dining Hall' },
];

export function ReportFilterBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentType = searchParams.get('type') || '';
  const currentCategory = searchParams.get('category') || '';
  const currentQuery = searchParams.get('q') || '';
  const currentLocationArea = searchParams.get('locationArea') || '';

  const [searchVal, setSearchVal] = useState(currentQuery);

  useEffect(() => {
    setSearchVal(currentQuery);
  }, [currentQuery]);

  const updateParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`${pathname}?${params.toString()}`);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateParam('q', searchVal.trim());
  };

  return (
    <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs space-y-3.5">
      {/* Top row: Type Segmented Toggle + Search Input */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        {/* Segmented Type Toggle */}
        <div className="inline-flex p-1 bg-slate-100 rounded-xl border border-slate-200/60 shrink-0">
          <button
            onClick={() => updateParam('type', '')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              currentType === ''
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All Items
          </button>
          <button
            onClick={() => updateParam('type', 'LOST')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              currentType === 'LOST'
                ? 'bg-white text-rose-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
            Lost Items
          </button>
          <button
            onClick={() => updateParam('type', 'FOUND')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              currentType === 'FOUND'
                ? 'bg-white text-emerald-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Found Items
          </button>
        </div>

        {/* Search input with ⌘K aesthetic */}
        <form onSubmit={handleSearchSubmit} className="relative flex-1">
          <SearchIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchVal}
            onChange={(e) => setSearchVal(e.target.value)}
            onBlur={() => updateParam('q', searchVal.trim())}
            placeholder="Search items (e.g., MacBook, water bottle, AirPods)..."
            className="w-full pl-9 pr-12 py-2 text-xs bg-slate-50 border border-slate-200/80 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition placeholder:text-slate-400"
          />
          <button
            type="submit"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono font-semibold px-1.5 py-0.5 bg-slate-200 text-slate-500 rounded border border-slate-300"
          >
            Enter
          </button>
        </form>

        {/* Location Zone Dropdown */}
        <div className="shrink-0">
          <select
            value={currentLocationArea}
            onChange={(e) => updateParam('locationArea', e.target.value)}
            className="w-full sm:w-auto text-xs py-2 px-3 bg-slate-50 border border-slate-200/80 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-700 font-medium"
          >
            {CAMPUS_ZONES.map((zone) => (
              <option key={zone.value} value={zone.value}>
                {zone.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Bottom row: Category Filter Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mr-1 shrink-0">
          Category:
        </span>
        {CATEGORIES.map((cat) => {
          const isSelected = (cat === 'All' && !currentCategory) || currentCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => updateParam('category', cat === 'All' ? '' : cat)}
              className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                isSelected
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
              }`}
            >
              {cat}
            </button>
          );
        })}
      </div>
    </div>
  );
}

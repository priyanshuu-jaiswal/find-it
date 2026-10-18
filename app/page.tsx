'use client';

import React from 'react';
import Link from 'next/link';
import { SearchIcon, ShieldIcon, SparklesIcon, ArrowRightIcon, LockIcon } from '@/src/components/ui/icons';

const TEST_PERSONAS = [
  {
    name: 'Alice Chen',
    email: 'alice@apex.edu',
    role: 'MEMBER',
    badge: 'Lost Item Owner',
    color: 'border-rose-200 bg-rose-50/60 text-rose-800',
    description: 'Post lost property, review candidate matches, and submit ownership claims.',
    targetUrl: '/apex-university/reports',
  },
  {
    name: 'Bob Smith',
    email: 'bob@apex.edu',
    role: 'MEMBER',
    badge: 'Campus Finder',
    color: 'border-emerald-200 bg-emerald-50/60 text-emerald-800',
    description: 'Post found property with presigned image upload and review incoming claims.',
    targetUrl: '/apex-university/reports',
  },
  {
    name: 'Carol Davis',
    email: 'carol@apex.edu',
    role: 'MODERATOR',
    badge: 'Campus Safety Moderator',
    color: 'border-indigo-200 bg-indigo-50/60 text-indigo-800',
    description: 'Inspect flagged listings, take HIDE/RESTORE enforcement, and view audit trail.',
    targetUrl: '/apex-university/moderation',
  },
];

export default function HomePage() {
  const handleSelectPersona = (email: string, targetUrl: string) => {
    document.cookie = `findit-persona=${encodeURIComponent(email)}; path=/; max-age=86400`;
    window.location.href = targetUrl;
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white flex flex-col justify-between selection:bg-indigo-500 selection:text-white">
      {/* Background radial glow */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-indigo-900/30 via-slate-950 to-slate-950 pointer-events-none" />

      {/* Navigation header */}
      <header className="relative z-10 max-w-7xl mx-auto w-full px-6 py-6 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-indigo-600 flex items-center justify-center font-black text-xl shadow-lg shadow-indigo-600/30">
            F
          </div>
          <div>
            <span className="font-extrabold text-lg tracking-tight block">FindIt</span>
            <span className="text-[11px] text-indigo-400 font-semibold uppercase tracking-wider block -mt-1">
              Apex University
            </span>
          </div>
        </div>

        <Link
          href="/apex-university/reports"
          className="text-xs font-bold px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition shadow-md shadow-indigo-600/20"
        >
          Open Campus Feed →
        </Link>
      </header>

      {/* Hero Section */}
      <section className="relative z-10 max-w-4xl mx-auto px-6 py-12 text-center space-y-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-500/10 border border-indigo-400/20 rounded-full text-xs font-semibold text-indigo-300">
          <SparklesIcon className="w-3.5 h-3.5 text-indigo-400" />
          <span>Production-Hardened Campus Recovery Engine</span>
        </div>

        <h1 className="text-4xl sm:text-6xl font-black tracking-tight leading-tight sm:leading-none text-slate-100">
          Reuniting campus property with{' '}
          <span className="bg-gradient-to-r from-indigo-400 to-teal-300 bg-clip-text text-transparent">
            mathematical precision.
          </span>
        </h1>

        <p className="text-sm sm:text-base text-slate-400 max-w-2xl mx-auto leading-relaxed">
          Centralized lost & found platform featuring deterministic multi-factor matching,
          EXIF-sanitized image uploads, private ownership claims, and concurrency-locked handoff coordination.
        </p>

        {/* CTA Launch Cards */}
        <div className="pt-8">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-4">
            Select a campus persona to launch interactive experience:
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
            {TEST_PERSONAS.map((p) => (
              <div
                key={p.email}
                onClick={() => handleSelectPersona(p.email, p.targetUrl)}
                className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-indigo-500/50 hover:bg-slate-900 transition-all cursor-pointer group shadow-lg flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${p.color}`}>
                      {p.badge}
                    </span>
                    <ArrowRightIcon className="w-4 h-4 text-slate-600 group-hover:text-indigo-400 group-hover:translate-x-1 transition-all" />
                  </div>
                  <h3 className="font-bold text-slate-200 text-sm">{p.name}</h3>
                  <span className="text-[11px] text-slate-500 font-mono block mb-2">{p.email}</span>
                  <p className="text-xs text-slate-400 leading-relaxed">{p.description}</p>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/80 text-[11px] font-bold text-indigo-400 flex items-center gap-1">
                  <span>Launch as {p.name.split(' ')[0]}</span>
                  <span>→</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Feature Highlights Grid */}
      <section className="relative z-10 max-w-7xl mx-auto w-full px-6 py-10 border-t border-slate-800/60">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
          <div className="p-4 rounded-2xl bg-slate-900/50 border border-slate-800/80">
            <span className="font-bold text-slate-200 block mb-1">🎯 Deterministic Scorer</span>
            <span className="text-slate-400 leading-relaxed">
              5-factor algorithm (Category, Trigrams, Brand/Color, Location, Decay) with transparent reason chips.
            </span>
          </div>
          <div className="p-4 rounded-2xl bg-slate-900/50 border border-slate-800/80">
            <span className="font-bold text-slate-200 block mb-1">🔒 Private Proof Vault</span>
            <span className="text-slate-400 leading-relaxed">
              Ownership proof text is excluded from public endpoints, encrypted, and visible strictly to report owners.
            </span>
          </div>
          <div className="p-4 rounded-2xl bg-slate-900/50 border border-slate-800/80">
            <span className="font-bold text-slate-200 block mb-1">🤝 Atomic Handoff Lock</span>
            <span className="text-slate-400 leading-relaxed">
              PostgreSQL <code className="text-indigo-400">FOR UPDATE</code> lock guarantees single active approval under concurrent race conditions.
            </span>
          </div>
          <div className="p-4 rounded-2xl bg-slate-900/50 border border-slate-800/80">
            <span className="font-bold text-slate-200 block mb-1">⚡ Serverless Job Queue</span>
            <span className="text-slate-400 leading-relaxed">
              PostgreSQL <code className="text-indigo-400">SKIP LOCKED</code> workers process EXIF stripping & candidate matches with zero Redis.
            </span>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 max-w-7xl mx-auto w-full px-6 py-6 text-center text-xs text-slate-600 border-t border-slate-900">
        FindIt Campus Lost & Found System • Apex University Production Build
      </footer>
    </main>
  );
}

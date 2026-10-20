'use client';

import React from 'react';
import Link from 'next/link';
import { SearchIcon, ShieldIcon, SparklesIcon, ArrowRightIcon, LockIcon } from '@/src/components/ui/icons';

const TEST_PERSONAS = [
  {
    name: 'Arjun Rao',
    email: 'arjun@cmrit.ac.in',
    role: 'MEMBER',
    badge: 'Lost Item Owner',
    color: 'border-rose-200 bg-rose-50/60 text-rose-800',
    description: 'Post lost property, review candidate matches, and submit ownership claims.',
    targetUrl: '/cmrit-lost-and-found/reports',
  },
  {
    name: 'Priya Sharma',
    email: 'priya@cmrit.ac.in',
    role: 'MEMBER',
    badge: 'Campus Finder',
    color: 'border-emerald-200 bg-emerald-50/60 text-emerald-800',
    description: 'Post found property with presigned image upload and review incoming claims.',
    targetUrl: '/cmrit-lost-and-found/reports',
  },
  {
    name: 'CMRIT Safety Office',
    email: 'security@cmrit.ac.in',
    role: 'MODERATOR',
    badge: 'Campus Safety Moderator',
    color: 'border-indigo-200 bg-indigo-50/60 text-indigo-800',
    description: 'Inspect flagged listings, take HIDE/RESTORE enforcement, and view audit trail.',
    targetUrl: '/cmrit-lost-and-found/moderation',
    code: 'CMRIT_MOD_2026',
  },
];

export default function HomePage() {
  const handleSelectPersona = async (email: string, targetUrl: string, code?: string) => {
    try {
      await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, moderatorCode: code }),
      });
      window.location.href = targetUrl;
    } catch {
      window.location.href = targetUrl;
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white flex flex-col justify-between selection:bg-indigo-500 selection:text-white">
      {/* Background glow */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-indigo-900/30 via-slate-950 to-slate-950 pointer-events-none" />

      {/* Top bar */}
      <header className="relative z-10 max-w-7xl mx-auto w-full px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-indigo-700 flex items-center justify-center font-black text-base shadow-lg shadow-indigo-700/30">
            C
          </div>
          <div>
            <span className="font-extrabold text-base tracking-tight block">CMRIT Lost & Found</span>
            <span className="text-[10px] text-indigo-400 font-semibold uppercase tracking-wider block -mt-0.5">
              CMR Institute of Technology, Bengaluru
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Link
            href="/login"
            className="text-xs font-semibold px-3.5 py-2 text-slate-300 hover:text-white transition"
          >
            Sign In
          </Link>
          <Link
            href="/cmrit-lost-and-found/reports"
            className="text-xs font-bold px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition shadow-md shadow-indigo-600/20"
          >
            Open CMRIT Feed →
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 max-w-4xl mx-auto px-6 py-12 text-center space-y-5">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-500/10 border border-indigo-400/20 rounded-full text-xs font-semibold text-indigo-300">
          <SparklesIcon className="w-3.5 h-3.5 text-indigo-400" />
          <span>CMRIT Campus Recovery Platform</span>
        </div>

        <h1 className="text-3xl sm:text-5xl font-black tracking-tight leading-tight text-slate-100">
          CMRIT Campus Lost & Found{' '}
          <span className="bg-gradient-to-r from-indigo-400 to-teal-300 bg-clip-text text-transparent">
            Simplified.
          </span>
        </h1>

        <p className="text-xs sm:text-sm text-slate-400 max-w-xl mx-auto leading-relaxed">
          Centralized lost & found platform for CMRIT students and faculty.
          Deterministic candidate matching, EXIF-sanitized image uploads, private claims, and concurrency-locked handoff.
        </p>

        {/* Persona quick launch */}
        <div className="pt-6">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-3">
            Select a campus profile to enter or test:
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 text-left">
            {TEST_PERSONAS.map((p) => (
              <div
                key={p.email}
                onClick={() => handleSelectPersona(p.email, p.targetUrl, p.code)}
                className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-indigo-500/50 hover:bg-slate-900 transition-all cursor-pointer group shadow-lg flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${p.color}`}>
                      {p.badge}
                    </span>
                    <ArrowRightIcon className="w-3.5 h-3.5 text-slate-600 group-hover:text-indigo-400 group-hover:translate-x-1 transition-all" />
                  </div>
                  <h3 className="font-bold text-slate-200 text-xs sm:text-sm">{p.name}</h3>
                  <span className="text-[10px] text-slate-500 font-mono block mb-1.5">{p.email}</span>
                  <p className="text-[11px] text-slate-400 leading-relaxed">{p.description}</p>
                </div>

                <div className="mt-3 pt-2.5 border-t border-slate-800/80 text-[10px] font-bold text-indigo-400 flex items-center gap-1">
                  <span>Enter as {p.name.split(' ')[0]}</span>
                  <span>→</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Minimal Footer */}
      <footer className="relative z-10 max-w-7xl mx-auto w-full px-6 py-5 text-center text-[11px] text-slate-600 border-t border-slate-900">
        CMR Institute of Technology (CMRIT) • Production Lost & Found Platform
      </footer>
    </main>
  );
}

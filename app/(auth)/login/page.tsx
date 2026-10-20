'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { ShieldIcon, ArrowRightIcon, CheckCircleIcon, LockIcon } from '@/src/components/ui/icons';

const TEST_ACCOUNTS = [
  {
    name: 'Arjun Rao',
    email: 'arjun@cmrit.ac.in',
    role: 'Student (CSE)',
    badge: 'Student',
    color: 'border-slate-200 hover:border-indigo-400 bg-white hover:bg-indigo-50/30',
  },
  {
    name: 'Priya Sharma',
    email: 'priya@cmrit.ac.in',
    role: 'Student (ISE)',
    badge: 'Student',
    color: 'border-slate-200 hover:border-indigo-400 bg-white hover:bg-indigo-50/30',
  },
  {
    name: 'CMRIT Safety Office',
    email: 'security@cmrit.ac.in',
    role: 'Campus Safety Moderator',
    badge: 'Moderator',
    color: 'border-indigo-200 hover:border-indigo-500 bg-indigo-50/40 hover:bg-indigo-50/70',
    code: 'CMRIT_MOD_2026',
  },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [moderatorCode, setModeratorCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleLogin = async (targetEmail: string, code?: string) => {
    setIsLoading(true);
    setErrorMessage(null);

    const emailToUse = targetEmail.trim().toLowerCase();
    const codeToUse = code ?? moderatorCode;

    if (!emailToUse || !emailToUse.includes('@')) {
      setErrorMessage('Please enter a valid campus email address');
      setIsLoading(false);
      return;
    }

    try {
      // 1. Authenticate via our custom session endpoint (sets HTTP-only cookie)
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailToUse,
          password: password || 'cmrit2026',
          moderatorCode: codeToUse,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message || 'Login failed');
      }

      // 2. Also register NextAuth JWT session
      await signIn('credentials', {
        email: emailToUse,
        password: password || 'cmrit2026',
        moderatorCode: codeToUse,
        redirect: false,
      }).catch(() => {});

      // 3. Navigate to CMRIT discovery feed
      router.push('/cmrit-lost-and-found/reports');
      router.refresh();
    } catch (err: any) {
      setErrorMessage(err.message || 'Authentication error. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8 py-12">
      <div className="max-w-md w-full space-y-6">
        {/* Header Branding */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-700 border border-indigo-200">
            <span>🛡️ Official Campus Verification</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            CMR Institute of Technology
          </h1>
          <p className="text-xs text-slate-500 font-medium">
            Lost & Found Campus Portal • Sign in with your @cmrit.ac.in account
          </p>
        </div>

        {/* Main Card */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl border border-slate-200/80 shadow-xs space-y-6">
          {/* Quick Switch Test Accounts (Vercel & Demo Friendly) */}
          <div className="space-y-2.5">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
              1-Click Demo Profiles (For Reviewers)
            </span>
            <div className="grid grid-cols-1 gap-2">
              {TEST_ACCOUNTS.map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  disabled={isLoading}
                  onClick={() => {
                    setEmail(acc.email);
                    if (acc.code) setModeratorCode(acc.code);
                    handleLogin(acc.email, acc.code);
                  }}
                  className={`p-3 rounded-2xl border text-left flex items-center justify-between transition cursor-pointer disabled:opacity-50 ${acc.color}`}
                >
                  <div className="min-w-0 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-slate-900">{acc.name}</span>
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                          acc.badge === 'Moderator'
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {acc.badge}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-500 block truncate">{acc.email}</span>
                  </div>
                  <span className="text-xs text-indigo-600 font-bold shrink-0">Sign in →</span>
                </button>
              ))}
            </div>
          </div>

          <div className="relative flex py-1 items-center">
            <div className="flex-grow border-t border-slate-200" />
            <span className="flex-shrink mx-3 text-[11px] font-bold uppercase text-slate-400">
              Or Sign In With Custom Email
            </span>
            <div className="flex-grow border-t border-slate-200" />
          </div>

          {/* Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleLogin(email);
            }}
            className="space-y-4"
          >
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">
                CMRIT Email Address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your.name@cmrit.ac.in"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="•••••••• (Any password for campus demo)"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                  <span>Moderator Access Code</span>
                  <span className="text-[10px] text-slate-400 font-normal">(Optional)</span>
                </label>
                <button
                  type="button"
                  onClick={() => setModeratorCode('CMRIT_MOD_2026')}
                  className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 transition"
                >
                  Quick-fill code
                </button>
              </div>
              <input
                type="text"
                value={moderatorCode}
                onChange={(e) => setModeratorCode(e.target.value)}
                placeholder="CMRIT_MOD_2026 for Safety Moderator permissions"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition font-mono"
              />
            </div>

            {errorMessage && (
              <div className="p-3 bg-rose-50 text-rose-700 text-xs rounded-xl border border-rose-200">
                {errorMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md transition cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isLoading ? (
                <span>Authenticating...</span>
              ) : (
                <>
                  <span>Sign In to CMRIT Portal</span>
                  <ArrowRightIcon className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </form>

          {/* Guest Link */}
          <div className="pt-2 text-center border-t border-slate-100">
            <Link
              href="/cmrit-lost-and-found/reports"
              className="text-xs text-slate-500 hover:text-slate-800 font-medium transition"
            >
              Browse Campus Feed Without Signing In →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

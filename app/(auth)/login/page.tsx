'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { ShieldIcon, LockIcon, ArrowRightIcon, CheckCircleIcon } from '@/src/components/ui/icons';

export default function LoginPage() {
  const router = useRouter();

  // Mode: 'student' (Student & Faculty) | 'admin' (Admin Login)
  const [activeTab, setActiveTab] = useState<'student' | 'admin'>('student');

  // Student & Faculty auth mode: 'signin' | 'signup'
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');

  // Form fields
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Admin fields
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleStudentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail.endsWith('@cmrit.ac.in')) {
      setErrorMessage('Access is restricted exclusively to official CMRIT accounts ending in @cmrit.ac.in');
      return;
    }

    if (!password || password.length < 6) {
      setErrorMessage('Password must be at least 6 characters');
      return;
    }

    if (authMode === 'signup') {
      if (!displayName.trim()) {
        setErrorMessage('Please enter your full name');
        return;
      }
      if (password !== confirmPassword) {
        setErrorMessage('Passwords do not match');
        return;
      }
    }

    setIsLoading(true);

    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          password,
          mode: authMode,
          isAdminLogin: false,
          displayName: displayName.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Authentication failed');
      }

      // Also register NextAuth session
      await signIn('credentials', {
        email: cleanEmail,
        password,
        redirect: false,
      }).catch(() => {});

      if (authMode === 'signup') {
        setSuccessMessage('Account created successfully! Redirecting to campus feed...');
      }

      setTimeout(() => {
        router.push(data.data?.redirectUrl || '/cmrit-lost-and-found/reports');
        router.refresh();
      }, authMode === 'signup' ? 600 : 100);
    } catch (err: any) {
      setErrorMessage(err.message || 'Authentication error. Please try again.');
      setIsLoading(false);
    }
  };

  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const cleanEmail = adminEmail.trim().toLowerCase();

    if (!cleanEmail.endsWith('@cmrit.ac.in')) {
      setErrorMessage('Access is restricted exclusively to official CMRIT accounts ending in @cmrit.ac.in');
      return;
    }

    if (!adminPassword) {
      setErrorMessage('Please enter your administrator password');
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          password: adminPassword,
          isAdminLogin: true,
          mode: 'signin',
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Admin authentication failed');
      }

      await signIn('credentials', {
        email: cleanEmail,
        password: adminPassword,
        redirect: false,
      }).catch(() => {});

      router.push(data.data?.redirectUrl || '/cmrit-lost-and-found/moderation');
      router.refresh();
    } catch (err: any) {
      setErrorMessage(err.message || 'Admin authentication error. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8 py-12">
      <div className="max-w-md w-full space-y-6">
        {/* Campus Header Branding */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/80">
            <ShieldIcon className="w-3.5 h-3.5 text-indigo-600" />
            <span>Official Campus Portal</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            CMR Institute of Technology
          </h1>
          <p className="text-xs text-slate-500 font-medium">
            Lost &amp; Found Campus Verification Portal • Exclusively for @cmrit.ac.in
          </p>
        </div>

        {/* Dual-Tab Segmented Selector */}
        <div className="bg-slate-200/70 p-1.5 rounded-2xl flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setActiveTab('student');
              setErrorMessage(null);
            }}
            className={`flex-1 py-2 text-xs font-bold rounded-xl transition cursor-pointer flex items-center justify-center gap-2 ${
              activeTab === 'student'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>🎓</span>
            <span>Student &amp; Faculty</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('admin');
              setErrorMessage(null);
            }}
            className={`flex-1 py-2 text-xs font-bold rounded-xl transition cursor-pointer flex items-center justify-center gap-2 ${
              activeTab === 'admin'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <LockIcon className="w-3.5 h-3.5" />
            <span>Admin Login</span>
          </button>
        </div>

        {/* Main Authentication Card */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl border border-slate-200/80 shadow-xs space-y-5">
          {activeTab === 'student' ? (
            /* TAB 1: STUDENT & FACULTY */
            <div className="space-y-5">
              {/* Sign In vs Sign Up Toggle */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <h2 className="text-sm font-extrabold text-slate-900">
                    {authMode === 'signin' ? 'Sign In to Your Account' : 'Create Student / Faculty Account'}
                  </h2>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {authMode === 'signin'
                      ? 'Enter your @cmrit.ac.in credentials to continue'
                      : 'Register your official college email for campus access'}
                  </p>
                </div>
                <div className="inline-flex p-1 bg-slate-100 rounded-xl text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('signin');
                      setErrorMessage(null);
                    }}
                    className={`px-3 py-1 rounded-lg transition ${
                      authMode === 'signin'
                        ? 'bg-white text-slate-900 shadow-xs font-bold'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('signup');
                      setErrorMessage(null);
                    }}
                    className={`px-3 py-1 rounded-lg transition ${
                      authMode === 'signup'
                        ? 'bg-white text-indigo-600 shadow-xs font-bold'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Sign Up
                  </button>
                </div>
              </div>

              <form onSubmit={handleStudentSubmit} className="space-y-4">
                {authMode === 'signup' && (
                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1">
                      Full Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="e.g. Priyanshu Jaiswal"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
                    />
                  </div>
                )}

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    CMRIT Email Address *
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@cmrit.ac.in"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
                  />
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    Must end with @cmrit.ac.in
                  </span>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Password *
                  </label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="•••••••• (Min. 6 characters)"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
                  />
                </div>

                {authMode === 'signup' && (
                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1">
                      Confirm Password *
                    </label>
                    <input
                      type="password"
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
                    />
                  </div>
                )}

                {errorMessage && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-medium">
                    {errorMessage}
                  </div>
                )}

                {successMessage && (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-medium flex items-center gap-2">
                    <CheckCircleIcon className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{successMessage}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md transition cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isLoading ? (
                    <span>Authenticating...</span>
                  ) : authMode === 'signup' ? (
                    <>
                      <span>Create Account &amp; Enter Portal</span>
                      <ArrowRightIcon className="w-3.5 h-3.5" />
                    </>
                  ) : (
                    <>
                      <span>Sign In to CMRIT Portal</span>
                      <ArrowRightIcon className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </form>
            </div>
          ) : (
            /* TAB 2: ADMIN LOGIN */
            <div className="space-y-5">
              <div className="border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold">
                    <ShieldIcon className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-extrabold text-slate-900">
                      Campus Security &amp; Admin Console
                    </h2>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Restricted to CMRIT safety officers and portal administrators
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200/80 rounded-2xl text-[11px] text-amber-900 leading-relaxed">
                <strong>Administrative Access Notice:</strong> Regular student and faculty accounts cannot sign in through this tab. Please use the Student &amp; Faculty tab for personal reports.
              </div>

              <form onSubmit={handleAdminSubmit} className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Administrator Email *
                  </label>
                  <input
                    type="email"
                    required
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    placeholder="admin@cmrit.ac.in"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Admin Password *
                  </label>
                  <input
                    type="password"
                    required
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
                  />
                </div>

                {errorMessage && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-medium">
                    {errorMessage}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-md transition cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isLoading ? (
                    <span>Verifying Admin Credentials...</span>
                  ) : (
                    <>
                      <LockIcon className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Authenticate as Administrator</span>
                    </>
                  )}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { ShieldIcon, SearchIcon, PlusIcon, MessageSquareIcon } from '../ui/icons';

interface TopNavbarProps {
  orgSlug: string;
  currentUser?: {
    displayName: string;
    email: string;
    role: string;
  };
}

export function TopNavbar({ orgSlug, currentUser }: TopNavbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const isModerator = currentUser?.role === 'MODERATOR' || currentUser?.role === 'ORG_ADMIN';

  const handleLogout = async () => {
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST' });
      await signOut({ redirect: false }).catch(() => {});
      router.push('/login');
      router.refresh();
    } catch {
      window.location.href = '/login';
    }
  };

  const navLinks = [
    {
      name: 'Discovery Feed',
      href: `/${orgSlug}/reports`,
      icon: SearchIcon,
      active: pathname === `/${orgSlug}/reports`,
    },
    {
      name: 'Post Item',
      href: `/${orgSlug}/reports/new`,
      icon: PlusIcon,
      active: pathname === `/${orgSlug}/reports/new`,
    },
    {
      name: 'Claims Inbox',
      href: `/${orgSlug}/claims`,
      icon: MessageSquareIcon,
      active: pathname.startsWith(`/${orgSlug}/claims`),
    },
    ...(isModerator
      ? [
          {
            name: 'Moderator Console',
            href: `/${orgSlug}/moderation`,
            icon: ShieldIcon,
            active: pathname.startsWith(`/${orgSlug}/moderation`),
          },
        ]
      : []),
  ];

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-15 flex items-center justify-between">
        {/* Left: CMRIT Brand */}
        <div className="flex items-center gap-6">
          <Link href={`/${orgSlug}/reports`} className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg bg-indigo-700 text-white flex items-center justify-center font-black text-sm shadow-xs group-hover:bg-indigo-600 transition">
              C
            </div>
            <div>
              <div className="flex items-center gap-1.5 leading-none">
                <span className="font-bold text-slate-900 tracking-tight text-sm">
                  CMRIT Lost & Found
                </span>
                <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded border border-indigo-200/60">
                  Campus
                </span>
              </div>
              <span className="text-[11px] text-slate-400 font-medium block mt-0.5">
                CMR Institute of Technology
              </span>
            </div>
          </Link>

          {/* Navigation links */}
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => {
              const Icon = link.icon;
              return (
                <Link
                  key={link.name}
                  href={link.href}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    link.active
                      ? 'bg-slate-100 text-slate-900 font-bold'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{link.name}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right: Active User & Logout Controls */}
        <div className="flex items-center gap-3">
          {currentUser ? (
            <div className="flex items-center gap-3 pl-3 border-l border-slate-200">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-bold shadow-xs">
                  {currentUser.displayName.charAt(0).toUpperCase()}
                </div>
                <div className="hidden sm:flex flex-col text-left">
                  <div className="flex items-center gap-1.5 leading-none">
                    <span className="text-xs font-bold text-slate-800">
                      {currentUser.displayName}
                    </span>
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                        isModerator
                          ? 'bg-indigo-100 text-indigo-700 border border-indigo-200'
                          : 'bg-slate-100 text-slate-600 border border-slate-200'
                      }`}
                    >
                      {isModerator ? 'Moderator' : 'Student'}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 mt-0.5 font-medium truncate max-w-[140px]">
                    {currentUser.email}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleLogout}
                title="Sign out or switch accounts"
                className="px-2.5 py-1.2 rounded-lg border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 text-xs font-semibold transition cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-xs transition"
            >
              Sign In
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { ShieldIcon, SearchIcon, PlusIcon, MessageSquareIcon, MapPinIcon } from '../ui/icons';

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
  const isAdmin = currentUser?.role === 'ORG_ADMIN';
  const isModerator = currentUser?.role === 'MODERATOR' || isAdmin;

  const handleLogout = async () => {
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST' });
      await signOut({ redirect: false }).catch(() => {});
      router.push('/login');
      router.refresh();
    } catch {
      router.push('/login');
    }
  };

  const navLinks = [
    {
      name: 'Feed',
      fullName: 'Discovery Feed',
      href: `/${orgSlug}/reports`,
      icon: SearchIcon,
      active: pathname === `/${orgSlug}/reports`,
    },
    {
      name: 'Post',
      fullName: 'Post Item',
      href: `/${orgSlug}/reports/new`,
      icon: PlusIcon,
      active: pathname === `/${orgSlug}/reports/new`,
    },
    {
      name: 'Claims',
      fullName: 'Claims Inbox',
      href: `/${orgSlug}/claims`,
      icon: MessageSquareIcon,
      active: pathname.startsWith(`/${orgSlug}/claims`),
    },
    ...(isModerator
      ? [
          {
            name: 'Moderation',
            fullName: 'Moderator Console',
            href: `/${orgSlug}/moderation`,
            icon: ShieldIcon,
            active: pathname.startsWith(`/${orgSlug}/moderation`),
          },
        ]
      : []),
    ...(isAdmin
      ? [
          {
            name: 'Locations',
            fullName: 'Campus Locations',
            href: `/${orgSlug}/admin/locations`,
            icon: MapPinIcon,
            active: pathname.startsWith(`/${orgSlug}/admin/locations`),
          },
        ]
      : []),
  ];

  return (
    <>
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-14 sm:h-15 flex items-center justify-between gap-2">
          {/* Left: CMRIT Brand */}
          <div className="flex items-center gap-3 sm:gap-6 min-w-0">
            <Link href={`/${orgSlug}/reports`} className="flex items-center gap-2 sm:gap-2.5 group min-w-0">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-indigo-700 text-white flex items-center justify-center font-black text-xs sm:text-sm shadow-xs group-hover:bg-indigo-600 transition shrink-0">
                C
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1 sm:gap-1.5 leading-none">
                  <span className="font-bold text-slate-900 tracking-tight text-xs sm:text-sm truncate">
                    CMRIT Lost &amp; Found
                  </span>
                  <span className="text-[8px] sm:text-[9px] uppercase font-bold px-1 sm:px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded border border-indigo-200/60 hidden xs:inline-block">
                    Campus
                  </span>
                </div>
                <span className="text-[10px] sm:text-[11px] text-slate-400 font-medium hidden sm:block mt-0.5 truncate">
                  CMR Institute of Technology
                </span>
              </div>
            </Link>

            {/* Navigation links for Desktop */}
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
                    <span>{link.fullName}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Right: Active User & Logout Controls */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {currentUser ? (
              <div className="flex items-center gap-2 sm:gap-3 pl-2 sm:pl-3 border-l border-slate-200">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-slate-900 text-white flex items-center justify-center text-[11px] sm:text-xs font-bold shadow-xs">
                    {currentUser.displayName.charAt(0).toUpperCase()}
                  </div>
                  <div className="hidden sm:flex flex-col text-left">
                    <div className="flex items-center gap-1.5 leading-none">
                      <span className="text-xs font-bold text-slate-800">
                        {currentUser.displayName}
                      </span>
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                          isAdmin
                            ? 'bg-purple-100 text-purple-700 border border-purple-200'
                            : isModerator
                            ? 'bg-indigo-100 text-indigo-700 border border-indigo-200'
                            : 'bg-slate-100 text-slate-600 border border-slate-200'
                        }`}
                      >
                        {isAdmin ? 'Admin' : isModerator ? 'Moderator' : 'Student'}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 mt-0.5 font-medium truncate max-w-[130px]">
                      {currentUser.email}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleLogout}
                  title="Sign out or switch accounts"
                  className="px-2 sm:px-2.5 py-1 sm:py-1.2 rounded-lg border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 text-[11px] sm:text-xs font-semibold transition cursor-pointer"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <Link
                href="/login"
                className="px-3 sm:px-3.5 py-1.2 sm:py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-xs transition"
              >
                Sign In
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Mobile navigation"
        className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 md:hidden flex items-center justify-around py-1.5 px-1 shadow-sm pb-[calc(env(safe-area-inset-bottom)+0.4rem)]"
      >
        {navLinks.map((link) => {
          const Icon = link.icon;
          return (
            <Link
              key={link.name}
              href={link.href}
              className={`flex flex-col items-center justify-center gap-0.5 py-1 px-1.5 rounded-lg text-[10px] font-semibold transition min-w-0 flex-1 ${
                link.active
                  ? 'text-indigo-600 font-bold'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Icon className={`w-4 h-4 sm:w-5 sm:h-5 ${link.active ? 'text-indigo-600' : 'text-slate-500'}`} />
              <span className="truncate max-w-[58px] text-[9.5px] leading-tight">{link.name}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}

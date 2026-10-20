import { NextRequest, NextResponse } from 'next/server';
import { successResponse } from '@/src/lib/response';

export async function POST(req: NextRequest) {
  const response = NextResponse.json({ data: { success: true } });

  const cookiesToClear = [
    'cmrit-session',
    'findit-persona',
    'authjs.session-token',
    '__Secure-authjs.session-token',
    'authjs.csrf-token',
    '__Host-authjs.csrf-token',
  ];

  for (const name of cookiesToClear) {
    response.cookies.set(name, '', {
      path: '/',
      maxAge: 0,
      expires: new Date(0),
    });
  }

  return response;
}

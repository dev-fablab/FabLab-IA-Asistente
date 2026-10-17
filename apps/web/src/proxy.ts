import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

// Next.js 16 renombró `middleware` a `proxy`.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Solo las pantallas que dependen de la sesión. La API (/api) se protege en Hono.
  matcher: ['/admin/:path*', '/login'],
};

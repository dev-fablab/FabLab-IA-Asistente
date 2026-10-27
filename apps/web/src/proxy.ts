import { getAuth, whenSeeded } from '@fablab/server/auth';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Mejora la experiencia: sin sesión, `/admin` vuelve a `/login`.
 * La barrera de los datos sigue siendo la API (`requireStaff`).
 */
export async function proxy(request: NextRequest) {
  await whenSeeded();
  const session = await getAuth().api.getSession({ headers: request.headers });
  const isSignedIn = Boolean(session?.user);
  const { pathname } = request.nextUrl;

  if (!isSignedIn && pathname.startsWith('/admin')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (isSignedIn && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/admin/documents';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Solo las pantallas que dependen de la sesión. La API (/api) se protege en Hono.
  matcher: ['/admin/:path*', '/login'],
};

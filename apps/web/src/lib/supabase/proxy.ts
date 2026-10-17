import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Refresca la sesión de Supabase en cada petición y protege `/admin/*`.
 *
 * Esto mejora la experiencia (redirige a /login) pero no es la barrera de seguridad:
 * la API Hono verifica el JWT y el perfil en cada ruta `/api/admin/*`.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // `getClaims` valida la firma del JWT (no confía solo en la cookie).
  const { data } = await supabase.auth.getClaims();
  const isSignedIn = Boolean(data?.claims);
  const { pathname } = request.nextUrl;

  if (!isSignedIn && pathname.startsWith('/admin')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return redirectKeepingCookies(url, response);
  }

  if (isSignedIn && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/admin/documents';
    url.search = '';
    return redirectKeepingCookies(url, response);
  }

  return response;
}

/** Una redirección debe conservar las cookies de sesión que el refresco acaba de escribir. */
function redirectKeepingCookies(url: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(url);
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  from.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'cache-control' || key === 'expires' || key === 'pragma') {
      redirect.headers.set(key, value);
    }
  });
  return redirect;
}

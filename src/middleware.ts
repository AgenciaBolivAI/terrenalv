import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/supabase/config';

/**
 * Session refresh + admin gate. RLS is the real enforcement — this only keeps
 * auth cookies fresh and redirects anonymous visitors away from /admin/**.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = SUPABASE_URL;
  const anonKey = SUPABASE_ANON_KEY;
  // Without env vars the pages render their own "sin conexión" states.
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Do not run code between createServerClient and auth.getUser() — token
  // refresh writes cookies through the callbacks above.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isLogin = pathname === '/admin/login' || pathname.startsWith('/admin/login/');

  if (!user && !isLogin) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/admin/login';
    loginUrl.search = '';
    if (pathname !== '/admin') loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (user && isLogin) {
    // Already signed in (cookies present) — go to the panel. Invite links land
    // here WITHOUT cookies (tokens travel in the URL hash), so they still reach
    // the login page and its set-password flow.
    const panelUrl = request.nextUrl.clone();
    panelUrl.pathname = '/admin';
    panelUrl.search = '';
    return NextResponse.redirect(panelUrl);
  }

  return response;
}

export const config = {
  matcher: ['/admin/:path*'],
};

import { NextRequest, NextResponse } from 'next/server';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  allowedRolesFor,
  decodeJwtPayload,
  homeFor,
  isExpired,
} from './lib/auth';

const API_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:3000';

const PUBLIC_PATHS = ['/login', '/403'];

/**
 * Proxy (middleware) apps/admin — Fase 9.
 *
 * 1. Belum login (tidak ada token sama sekali) → redirect /login.
 * 2. Access token expired tapi refresh token ada → panggil POST /auth/refresh
 *    di API, teruskan Set-Cookie ke browser (auto-refresh tanpa login ulang).
 * 3. Role tidak berhak akses route (§5.1) → redirect /403.
 *
 * Catatan keamanan: decode payload di sini hanya untuk routing UX.
 * Enforcement data sesungguhnya tetap di API (AuthGuard).
 */
export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;

  let payload = accessToken ? decodeJwtPayload(accessToken) : null;
  const needsRefresh = !payload || isExpired(payload);

  let refreshedCookies: string[] = [];

  if (needsRefresh) {
    if (!refreshToken) {
      return redirectToLogin(request, pathname);
    }

    // Auto-refresh: rotasi refresh token + access token baru dari API
    const refreshResponse = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: `${REFRESH_TOKEN_COOKIE}=${refreshToken}` },
    }).catch(() => null);

    if (!refreshResponse || !refreshResponse.ok) {
      return redirectToLogin(request, pathname);
    }

    refreshedCookies = refreshResponse.headers.getSetCookie();
    const newAccessCookie = refreshedCookies.find((c) => c.startsWith(`${ACCESS_TOKEN_COOKIE}=`));
    const newAccessToken = newAccessCookie?.split(';')[0]?.split('=').slice(1).join('=');
    payload = newAccessToken ? decodeJwtPayload(newAccessToken) : null;

    if (!payload) {
      return redirectToLogin(request, pathname);
    }
  }

  // Root → halaman default per role
  if (pathname === '/') {
    const response = NextResponse.redirect(new URL(homeFor(payload!.role), request.url));
    applySetCookies(response, refreshedCookies);
    return response;
  }

  // RBAC per route (§5.1)
  const allowed = allowedRolesFor(pathname);
  if (allowed && (!payload!.role || !allowed.includes(payload!.role))) {
    const response = NextResponse.redirect(new URL('/403', request.url));
    applySetCookies(response, refreshedCookies);
    return response;
  }

  const response = NextResponse.next();
  applySetCookies(response, refreshedCookies);
  return response;
}

function redirectToLogin(request: NextRequest, from: string) {
  const url = new URL('/login', request.url);
  if (from !== '/') url.searchParams.set('from', from);
  const response = NextResponse.redirect(url);
  // Bersihkan cookie yang sudah tidak valid
  response.cookies.delete(ACCESS_TOKEN_COOKIE);
  response.cookies.delete(REFRESH_TOKEN_COOKIE);
  return response;
}

function applySetCookies(response: NextResponse, setCookies: string[]) {
  for (const cookie of setCookies) {
    response.headers.append('set-cookie', cookie);
  }
}

export const config = {
  // Semua route kecuali asset statis Next.js
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};

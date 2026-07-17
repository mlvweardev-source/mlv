import { NextRequest, NextResponse } from 'next/server';
import { CUSTOMER_TOKEN_COOKIE, decodeJwtPayload, isExpired, isProtectedPath } from './lib/auth';

/**
 * Proxy (middleware) apps/web — Fase 10 Bagian 1.
 *
 * Portal pelanggan mayoritas PUBLIK (landing, login, katalog). Hanya
 * route di PROTECTED_PREFIXES (riwayat pesanan dkk — Bagian 3) yang
 * butuh sesi: tanpa cookie pelanggan valid → redirect /login?from=...
 *
 * Beda dengan apps/admin: TIDAK ada auto-refresh (JWT pelanggan berumur
 * panjang tanpa refresh token) dan tidak ada RBAC per-route (semua
 * pelanggan setara).
 *
 * Catatan keamanan: decode payload TANPA verify hanya untuk routing UX —
 * enforcement data tetap di API (AuthGuard).
 */
export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!isProtectedPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(CUSTOMER_TOKEN_COOKIE)?.value;
  const payload = token ? decodeJwtPayload(token) : null;

  if (!payload || payload.actorType !== 'CUSTOMER' || isExpired(payload)) {
    const url = new URL('/login', request.url);
    url.searchParams.set('from', pathname);
    const response = NextResponse.redirect(url);
    if (token) response.cookies.delete(CUSTOMER_TOKEN_COOKIE);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  // Semua route kecuali asset statis Next.js
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};

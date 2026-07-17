// ==========================================
// Auth helpers apps/web — dipakai proxy.ts (edge) & server components.
// Decode JWT payload TANPA verifikasi signature: hanya untuk routing UX
// (redirect ke /login). Enforcement data sesungguhnya di API (AuthGuard) —
// cookie palsu tidak akan bisa mengambil data apa pun.
// Pola sama dengan apps/admin (Fase 9), cookie BEDA (mlv_customer_token).
// ==========================================

export const CUSTOMER_TOKEN_COOKIE = 'mlv_customer_token';

export interface CustomerSessionPayload {
  sub: string;
  actorType: string;
  email?: string;
  exp?: number;
}

export function decodeJwtPayload(token: string): CustomerSessionPayload | null {
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return null;
    const json = atob(payloadPart.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as CustomerSessionPayload;
  } catch {
    return null;
  }
}

export function isExpired(payload: CustomerSessionPayload): boolean {
  if (!payload.exp) return false;
  // 10 detik margin supaya token tidak keburu expired di tengah request
  return payload.exp * 1000 < Date.now() + 10_000;
}

/**
 * Prefix route yang butuh login pelanggan. Halaman lain publik.
 * /pesanan (riwayat order dkk) dibangun Bagian 3 — proteksinya
 * disiapkan sekarang sesuai scope Bagian 1.
 */
export const PROTECTED_PREFIXES = ['/pesanan', '/akun'];

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
}

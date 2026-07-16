// ==========================================
// Auth helpers — dipakai proxy.ts (edge) & client.
// Decode JWT payload TANPA verifikasi signature: hanya untuk routing UX
// (redirect/403). Enforcement sesungguhnya ada di API (AuthGuard, §5.1) —
// cookie palsu tidak akan bisa mengambil data apapun.
// ==========================================

export const ACCESS_TOKEN_COOKIE = 'mlv_access_token';
export const REFRESH_TOKEN_COOKIE = 'mlv_refresh_token';

export type StaffRole = 'OWNER' | 'MANAJER_PRODUKSI' | 'TIM_PENJAHIT';

export interface SessionPayload {
  sub: string;
  actorType: string;
  role?: StaffRole;
  email?: string;
  exp?: number;
}

export function decodeJwtPayload(token: string): SessionPayload | null {
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return null;
    const json = atob(payloadPart.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as SessionPayload;
  } catch {
    return null;
  }
}

export function isExpired(payload: SessionPayload): boolean {
  if (!payload.exp) return false;
  // 10 detik margin supaya token tidak keburu expired di tengah request
  return payload.exp * 1000 < Date.now() + 10_000;
}

export const ROLE_LABELS: Record<StaffRole, string> = {
  OWNER: 'Owner',
  MANAJER_PRODUKSI: 'Manajer Produksi',
  TIM_PENJAHIT: 'Tim Penjahit',
};

/**
 * Prefix route → role yang boleh akses (§5.1).
 * Route yang tidak terdaftar = semua staff boleh.
 */
export const ROUTE_ROLES: Array<{ prefix: string; roles: StaffRole[] }> = [
  { prefix: '/dashboard', roles: ['OWNER', 'MANAJER_PRODUKSI'] },
  { prefix: '/orders', roles: ['OWNER', 'MANAJER_PRODUKSI', 'TIM_PENJAHIT'] },
  { prefix: '/production', roles: ['OWNER', 'MANAJER_PRODUKSI', 'TIM_PENJAHIT'] },
  { prefix: '/inventory', roles: ['OWNER', 'MANAJER_PRODUKSI', 'TIM_PENJAHIT'] },
  // §5.1 TEGAS: profit sharing Owner-only ("❌" untuk Manajer & Penjahit).
  // HARUS di atas '/finance' — allowedRolesFor pakai first-match prefix.
  { prefix: '/finance/profit-sharing', roles: ['OWNER'] },
  { prefix: '/finance', roles: ['OWNER', 'MANAJER_PRODUKSI'] },
  { prefix: '/approvals', roles: ['OWNER', 'MANAJER_PRODUKSI'] },
  { prefix: '/shipping', roles: ['OWNER', 'MANAJER_PRODUKSI'] },
  { prefix: '/notifications', roles: ['OWNER', 'MANAJER_PRODUKSI', 'TIM_PENJAHIT'] },
  { prefix: '/chat', roles: ['OWNER', 'MANAJER_PRODUKSI', 'TIM_PENJAHIT'] },
  { prefix: '/users', roles: ['OWNER'] },
];

export function allowedRolesFor(pathname: string): StaffRole[] | null {
  const match = ROUTE_ROLES.find((r) => pathname.startsWith(r.prefix));
  return match ? match.roles : null;
}

/** Halaman default per role setelah login. */
export function homeFor(role: StaffRole | undefined): string {
  return role === 'TIM_PENJAHIT' ? '/orders' : '/dashboard';
}

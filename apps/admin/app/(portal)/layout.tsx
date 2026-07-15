import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCESS_TOKEN_COOKIE, decodeJwtPayload, type StaffRole } from '@/lib/auth';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';

const API_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:3000';

/**
 * Layout portal (route group): sidebar + topbar untuk semua halaman
 * setelah login. proxy.ts sudah menjamin token valid & role berhak —
 * di sini decode payload untuk role dan fetch /auth/me untuk nama user.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  const payload = accessToken ? decodeJwtPayload(accessToken) : null;

  if (!payload || !payload.role) {
    redirect('/login');
  }

  // Ambil nama user dari API (server-side, cookie diteruskan manual)
  let nama = payload.email ?? '';
  try {
    const me = await fetch(`${API_URL}/auth/me`, {
      headers: { cookie: `${ACCESS_TOKEN_COOKIE}=${accessToken}` },
      cache: 'no-store',
    });
    if (me.ok) {
      const data = (await me.json()) as { nama?: string };
      if (data.nama) nama = data.nama;
    }
  } catch {
    // API down — tetap render shell dengan email sebagai fallback
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar role={payload.role as StaffRole} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar nama={nama} role={payload.role as StaffRole} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}

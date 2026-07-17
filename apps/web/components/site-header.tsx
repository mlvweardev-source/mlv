'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface Me {
  actorType: string;
  nama: string;
}

/**
 * Navigasi utama portal pelanggan. "Pesan Sekarang" → alur checkout
 * (Bagian 2) dan "Riwayat Pesanan" → portal pelanggan (Bagian 3) —
 * halaman placeholder untuk sekarang, sesuai scope Bagian 1.
 */
const NAV_ITEMS = [
  { href: '/', label: 'Beranda' },
  { href: '/pesan', label: 'Pesan Sekarang' },
  { href: '/pesanan', label: 'Riwayat Pesanan' },
];

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    // Cek sesi aktif via GET /auth/me (cookie httpOnly ikut otomatis).
    // 401 = belum login — bukan error, header tampil tombol "Masuk".
    apiFetch<Me>('/auth/me')
      .then((data) => setMe(data.actorType === 'CUSTOMER' ? data : null))
      .catch(() => setMe(null))
      .finally(() => setChecked(true));
  }, [pathname]);

  async function handleLogout() {
    try {
      await apiFetch('/auth/customer/logout', { method: 'POST' });
    } catch {
      // cookie tetap dihapus server-side; abaikan error jaringan
    }
    setMe(null);
    router.push('/');
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <div className="flex items-center gap-8">
          <Link href="/" className="text-lg font-bold tracking-tight">
            MLV
          </Link>
          <nav className="hidden items-center gap-6 sm:flex">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'text-sm transition-colors hover:text-foreground',
                  pathname === item.href ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {!checked ? null : me ? (
            <>
              <span className="hidden text-sm text-muted-foreground sm:inline">
                Halo, <span className="font-medium text-foreground">{me.nama}</span>
              </span>
              <Button variant="outline" size="sm" onClick={handleLogout}>
                Keluar
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => router.push('/login')}>
              Masuk
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { API_URL } from '@/lib/api';
import { ROLE_LABELS, type StaffRole } from '@/lib/auth';
import { Button } from '@/components/ui/button';

export function Topbar({ nama, role }: { nama: string; role: StaffRole }) {
  const router = useRouter();

  async function handleLogout() {
    // Revoke refresh token di DB + clear cookie httpOnly (dilakukan API)
    await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    }).catch(() => null);
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-6">
      <div />
      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-sm font-medium leading-tight">{nama}</p>
          <p className="text-xs text-muted-foreground">{ROLE_LABELS[role]}</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleLogout}>
          <LogOut className="h-4 w-4" />
          Logout
        </Button>
      </div>
    </header>
  );
}

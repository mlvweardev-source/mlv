import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/server-auth';
import { ProfitSharingClient } from './profit-sharing-client';

/**
 * §5.1 TEGAS: profit sharing Owner-only — Manajer & Penjahit ❌ total.
 * Lapisan enforcement: proxy.ts (ROUTE_ROLES /finance/profit-sharing →
 * redirect /403) → cek role di sini (defense in depth) → API @Roles(OWNER).
 */
export default async function ProfitSharingPage() {
  const role = await requireRole();

  if (role !== 'OWNER') {
    redirect('/403');
  }

  return <ProfitSharingClient />;
}

import { requireRole } from '@/lib/server-auth';
import { PurchasesClient } from './purchases-client';

export default async function PurchasesPage() {
  const role = await requireRole();
  // §5.1: buat PO & tandai diterima = Owner/Manajer saja; Penjahit view-only
  return <PurchasesClient canAct={role === 'OWNER' || role === 'MANAJER_PRODUKSI'} />;
}

import { requireRole } from '@/lib/server-auth';
import { AdjustmentsClient } from './adjustments-client';

export default async function AdjustmentsPage() {
  const role = await requireRole();
  // §5.1: buat adjustment = Owner/Manajer saja; Penjahit view-only
  return <AdjustmentsClient canAct={role === 'OWNER' || role === 'MANAJER_PRODUKSI'} />;
}

import { requireRole } from '@/lib/server-auth';
import { MaterialsClient } from './materials-client';

export default async function MaterialsPage() {
  const role = await requireRole();
  // §5.1: Inventory — Owner/Manajer full, Tim Penjahit view-only
  return <MaterialsClient canAct={role === 'OWNER' || role === 'MANAJER_PRODUKSI'} />;
}

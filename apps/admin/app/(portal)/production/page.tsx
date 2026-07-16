import { requireRole } from '@/lib/server-auth';
import { ProductionKanban } from './production-kanban';
import { MyTasksTable } from './my-tasks-table';

/**
 * Production UI role-based (keputusan Fase 9 Bagian 2):
 * - Owner & Manajer Produksi → kanban board per tahap produksi
 *   (bottleneck kelihatan sekilas dari tumpukan kartu per kolom).
 * - Tim Penjahit → tabel flat task miliknya sendiri saja.
 */
export default async function ProductionPage() {
  const role = await requireRole();

  if (role === 'TIM_PENJAHIT') {
    return <MyTasksTable />;
  }

  return <ProductionKanban />;
}

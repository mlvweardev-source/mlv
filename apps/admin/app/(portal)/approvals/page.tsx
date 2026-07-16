import { requireRole } from '@/lib/server-auth';
import { ApprovalsClient } from './approvals-client';

/**
 * Inbox approval (Fase 9.3, §13).
 * §5.1: Owner = lihat semua + Approve/Reject; Manajer = hanya lihat
 * status request yang dia ajukan sendiri (difilter backend), tanpa
 * tombol decide.
 */
export default async function ApprovalsPage() {
  const role = await requireRole();
  return <ApprovalsClient canDecide={role === 'OWNER'} />;
}

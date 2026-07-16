import { requireRole } from '@/lib/server-auth';
import { FinanceTabs } from './finance-tabs';

/**
 * Layout /finance (Fase 9.3): tab Payment/Invoice untuk Owner & Manajer
 * (view-only untuk Manajer di halaman ini — §5.1); tab Bagi Hasil hanya
 * dirender untuk Owner (lapisan 1 RBAC; lapisan 2 = proxy.ts redirect
 * /403; lapisan 3 = API @Roles(OWNER)).
 */
export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  const role = await requireRole();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Finance</h1>
        <p className="text-sm text-muted-foreground">
          Payment & invoice sistem-wide
          {role === 'OWNER' ? ', dan pengaturan bagi hasil' : ''}
        </p>
      </div>

      <FinanceTabs showProfitSharing={role === 'OWNER'} />

      {children}
    </div>
  );
}

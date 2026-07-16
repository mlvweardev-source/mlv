'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/**
 * Tab navigasi /finance — pola sama dengan layout tab Inventory (9.2).
 * Tab "Bagi Hasil" hanya dirender untuk Owner (§5.1 tegas: ❌ Manajer).
 */
export function FinanceTabs({ showProfitSharing }: { showProfitSharing: boolean }) {
  const pathname = usePathname();

  const tabs = [
    { href: '/finance/payments', label: 'Payment' },
    { href: '/finance/invoices', label: 'Invoice' },
    ...(showProfitSharing ? [{ href: '/finance/profit-sharing', label: 'Bagi Hasil' }] : []),
  ];

  return (
    <nav className="flex gap-1 border-b">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={cn(
            'border-b-2 px-4 py-2 text-sm font-medium transition-colors',
            pathname.startsWith(tab.href)
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

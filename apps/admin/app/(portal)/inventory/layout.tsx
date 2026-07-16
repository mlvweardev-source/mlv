'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/inventory/stock', label: 'Stok' },
  { href: '/inventory/materials', label: 'Material' },
  { href: '/inventory/bom', label: 'BOM' },
  { href: '/inventory/adjustments', label: 'Penyesuaian' },
  { href: '/inventory/purchases', label: 'Pembelian' },
];

export default function InventoryLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Inventory</h1>
        <p className="text-sm text-muted-foreground">
          Material, BOM, stok, penyesuaian, dan pembelian
        </p>
      </div>

      <nav className="flex gap-1 border-b">
        {TABS.map((tab) => (
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

      {children}
    </div>
  );
}

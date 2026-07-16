'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  ShoppingCart,
  Factory,
  Boxes,
  Wallet,
  BadgeCheck,
  Truck,
  Bell,
  MessagesSquare,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { allowedRolesFor, type StaffRole } from '@/lib/auth';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  comingSoon?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/orders', label: 'Order', icon: ShoppingCart },
  { href: '/production', label: 'Production', icon: Factory },
  { href: '/inventory', label: 'Inventory', icon: Boxes },
  { href: '/finance', label: 'Finance', icon: Wallet },
  { href: '/approvals', label: 'Approval', icon: BadgeCheck },
  { href: '/shipping', label: 'Shipping', icon: Truck },
  { href: '/notifications', label: 'Notifikasi', icon: Bell },
  { href: '/chat', label: 'Internal Chat', icon: MessagesSquare },
  { href: '/users', label: 'User & Role', icon: Users, comingSoon: true },
];

export function Sidebar({ role }: { role: StaffRole }) {
  const pathname = usePathname();

  // Sembunyikan menu yang rolenya tidak berhak (§5.1) — enforcement
  // sesungguhnya tetap di proxy.ts (redirect /403) dan API.
  const items = NAV_ITEMS.filter((item) => {
    const allowed = allowedRolesFor(item.href);
    return !allowed || allowed.includes(role);
  });

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r bg-sidebar">
      <div className="flex h-14 items-center border-b px-4">
        <Link href="/" className="text-lg font-bold tracking-tight">
          MLV Admin
        </Link>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {items.map((item) => {
          const active = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="flex-1">{item.label}</span>
              {item.comingSoon && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                  Soon
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

'use client';
// §13.22 left navigation — active item highlighted with red background + white text.
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavItem { href: string; label: string; icon: string }

export function NavLinks({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <>
      {items.map((n) => {
        const active = n.href === '/dashboard' ? path === '/' || path.startsWith('/dashboard') : path.startsWith(n.href);
        return (
          <Link key={n.href} href={n.href}
            className={`flex items-center gap-2.5 px-3 py-2 rounded text-sm ${
              active ? 'bg-[var(--ecs-red)] text-white font-medium' : 'text-[var(--ecs-text)] hover:bg-[var(--ecs-panel)] hover:text-[var(--ecs-navy)]'
            }`}>
            <span className={`w-4 text-center ${active ? 'text-white' : 'text-[var(--ecs-navy)]'}`}>{n.icon}</span>
            {n.label}
          </Link>
        );
      })}
    </>
  );
}

'use client';
// §13.22 left navigation — active item highlighted with red background + white text. Supports
// external links (existing ECS screens, opened in a new tab with ↗) and a one-level directory
// (a parent item with indented children, e.g. the Reporting Dashboard group).
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavItem { href: string; label: string; icon: string; external?: boolean; children?: NavItem[] }

function Row({ n, indent }: { n: NavItem; indent?: boolean }) {
  const path = usePathname();
  const active = !n.external && (n.href === '/dashboard' ? path === '/' || path.startsWith('/dashboard') : path.startsWith(n.href));
  const cls = `flex items-center gap-2.5 ${indent ? 'pl-8 pr-3' : 'px-3'} py-2 rounded text-sm ${
    active ? 'bg-[var(--ecs-red)] text-white font-medium' : 'text-[var(--ecs-text)] hover:bg-[var(--ecs-panel)] hover:text-[var(--ecs-navy)]'
  }`;
  const iconCls = `w-4 text-center ${active ? 'text-white' : 'text-[var(--ecs-navy)]'}`;
  if (n.external) {
    return (
      <a href={n.href} target="_blank" rel="noopener noreferrer" className={cls} title="Existing ECS screen — opens in the ECS app">
        <span className={iconCls}>{n.icon}</span>
        <span className="flex-1">{n.label}</span>
        <span aria-hidden className="text-[10px] opacity-60">↗</span>
      </a>
    );
  }
  return (
    <Link href={n.href} className={cls}>
      <span className={iconCls}>{n.icon}</span>
      {n.label}
    </Link>
  );
}

export function NavLinks({ items }: { items: NavItem[] }) {
  return (
    <>
      {items.map((n) =>
        n.children && n.children.length ? (
          <div key={n.href} className="space-y-0.5">
            <Row n={n} />
            {n.children.map((c) => <Row key={c.href} n={c} indent />)}
          </div>
        ) : (
          <Row key={n.href} n={n} />
        ),
      )}
    </>
  );
}

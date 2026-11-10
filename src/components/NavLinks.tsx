'use client';
// §13.22 left navigation — active item highlighted with red background + white text. Supports
// external links (existing ECS screens, opened in a new tab with ↗) and a one-level directory
// (a parent item with indented children, e.g. the Reporting Dashboard group). When `collapsed`
// the rows render as centred icons only, with the label as a hover title (desktop icon rail).
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavItem { href: string; label: string; icon: string; external?: boolean; children?: NavItem[] }

function Row({ n, indent, collapsed, onNavigate }: { n: NavItem; indent?: boolean; collapsed?: boolean; onNavigate?: () => void }) {
  const path = usePathname();
  const active = !n.external && (n.href === '/dashboard' ? path === '/' || path.startsWith('/dashboard') : path.startsWith(n.href));
  const cls = `flex items-center ${collapsed ? 'justify-center px-0' : `gap-2.5 ${indent ? 'pl-8 pr-3' : 'px-3'}`} py-2 rounded text-sm ${
    active ? 'bg-[var(--ecs-red)] text-white font-medium' : 'text-[var(--ecs-text)] hover:bg-[var(--ecs-panel)] hover:text-[var(--ecs-navy)]'
  }`;
  const iconCls = `w-4 text-center shrink-0 ${active ? 'text-white' : 'text-[var(--ecs-navy)]'}`;
  if (n.external) {
    return (
      <a href={n.href} target="_blank" rel="noopener noreferrer" onClick={onNavigate} className={cls} title={collapsed ? `${n.label} (opens in ECS)` : 'Existing ECS screen — opens in the ECS app'}>
        <span className={iconCls}>{n.icon}</span>
        {!collapsed && <span className="flex-1">{n.label}</span>}
        {!collapsed && <span aria-hidden className="text-[10px] opacity-60">↗</span>}
      </a>
    );
  }
  return (
    <Link href={n.href} onClick={onNavigate} className={cls} title={collapsed ? n.label : undefined}>
      <span className={iconCls}>{n.icon}</span>
      {!collapsed && <span>{n.label}</span>}
    </Link>
  );
}

export function NavLinks({ items, collapsed, onNavigate }: { items: NavItem[]; collapsed?: boolean; onNavigate?: () => void }) {
  return (
    <>
      {items.map((n) =>
        n.children && n.children.length ? (
          <div key={n.href} className="space-y-0.5">
            <Row n={n} collapsed={collapsed} onNavigate={onNavigate} />
            {n.children.map((c) => <Row key={c.href} n={c} indent collapsed={collapsed} onNavigate={onNavigate} />)}
          </div>
        ) : (
          <Row key={n.href} n={n} collapsed={collapsed} onNavigate={onNavigate} />
        ),
      )}
    </>
  );
}

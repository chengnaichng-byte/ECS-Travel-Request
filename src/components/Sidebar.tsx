'use client';
// §13.22 App sidebar. On desktop it docks and collapses to a slim icon rail (persisted); on mobile
// it is hidden and opens as an overlay drawer. Shares open/collapsed state with the header hamburger
// through SidebarContext. The nav data is passed in from the (server) Shell as serialisable props.
import { NavLinks, type NavItem } from './NavLinks';
import { useSidebar } from './SidebarContext';

export function Sidebar({ nav, setup, stubs }: { nav: NavItem[]; setup: NavItem[]; stubs: string[] }) {
  const { collapsed, mobileOpen, closeMobile } = useSidebar();

  const Body = ({ rail }: { rail: boolean }) => (
    <>
      <nav className="p-2 space-y-0.5">
        <NavLinks items={nav} collapsed={rail} onNavigate={closeMobile} />
      </nav>
      <div className={`${rail ? 'px-1' : 'px-3'} pt-4 pb-2 mt-2 border-t border-[var(--ecs-border)]`}>
        {!rail && <p className="text-[10px] uppercase tracking-wide text-[var(--ecs-muted)] mb-1">Setup &amp; Maintenance</p>}
        <div className="mb-1"><NavLinks items={setup} collapsed={rail} onNavigate={closeMobile} /></div>
        {!rail && (
          <ul className="space-y-0.5">
            {stubs.map((s) => (
              <li key={s} className="flex items-center gap-2.5 px-3 py-1.5 rounded text-sm text-slate-400 cursor-not-allowed select-none" title="Existing ECS screen — not rebuilt in the prototype (§13.18)">
                <span className="w-4 text-center">·</span>{s}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );

  return (
    <>
      {/* Desktop: docked, collapsible to an icon rail */}
      <aside
        className={`shrink-0 bg-white border-r border-[var(--ecs-border)] hidden md:flex md:flex-col overflow-y-auto transition-[width] duration-200 ${collapsed ? 'w-14' : 'w-60'}`}
        aria-label="Main navigation"
      >
        <Body rail={collapsed} />
      </aside>

      {/* Mobile: overlay drawer */}
      <div className={`md:hidden fixed inset-0 z-40 transition-opacity duration-200 ${mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} aria-hidden={!mobileOpen}>
        <div className="absolute inset-0 bg-black/40" onClick={closeMobile} />
        <aside
          className={`absolute inset-y-0 left-0 w-72 max-w-[85%] bg-white border-r border-[var(--ecs-border)] flex flex-col overflow-y-auto shadow-xl transition-transform duration-200 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
          aria-label="Main navigation"
        >
          <div className="flex items-center justify-between px-3 h-14 border-b border-[var(--ecs-border)]">
            <span className="text-sm font-semibold text-[var(--ecs-navy)]">Menu</span>
            <button type="button" onClick={closeMobile} aria-label="Close menu" className="inline-flex items-center justify-center w-9 h-9 rounded-full hover:bg-[var(--ecs-panel)] text-[var(--ecs-navy)]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
          <Body rail={false} />
        </aside>
      </div>
    </>
  );
}

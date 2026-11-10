'use client';
// §13.22 Header hamburger. On desktop it collapses/expands the docked sidebar to an icon rail;
// on mobile it opens the overlay drawer. State lives in SidebarContext.
import { useSidebar } from './SidebarContext';

export function SidebarToggle() {
  const { toggle, collapsed, mobileOpen } = useSidebar();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
      aria-expanded={!collapsed || mobileOpen}
      title="Menu"
      className="inline-flex shrink-0 items-center justify-center w-9 h-9 rounded-md border border-[var(--ecs-border)] bg-white text-[var(--ecs-navy)] hover:bg-[var(--ecs-panel)]"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
        <path d="M3 6h18M3 12h18M3 18h18" />
      </svg>
    </button>
  );
}

'use client';
// §13.22 Collapsible navigation state, shared between the header toggle (hamburger) and the sidebar.
// Desktop: the sidebar docks and collapses to a slim icon rail. Mobile: it opens as an overlay
// drawer. One toggle drives both, picking the behaviour from the viewport width.
//
// §4.1 The DEFAULT desktop state (shown vs the icon rail) is a per-staff profile preference read
// server-side by the Shell and passed in as `initialCollapsed`. The hamburger still overrides it
// for the current session; a reload (or a persona switch, or saving the preference) returns to the
// profile default. The profile preference owns the default, so there is no localStorage copy to go
// stale against it.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

interface SidebarState {
  collapsed: boolean;            // desktop icon-rail
  mobileOpen: boolean;           // mobile overlay drawer
  hydrated: boolean;             // retained for API stability (always true after mount)
  toggle: () => void;            // hamburger: collapse on desktop, open/close drawer on mobile
  closeMobile: () => void;
  setCollapsed: (v: boolean) => void;
}

const Ctx = createContext<SidebarState | null>(null);
const isDesktop = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;

export function SidebarProvider({ children, initialCollapsed = false }: { children: React.ReactNode; initialCollapsed?: boolean }) {
  const [collapsed, setCollapsedState] = useState(initialCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;

  // Apply the profile default whenever it changes server-side (persona switch, or the preference is
  // saved on the Staff Profile page). On ordinary navigation it is unchanged, so a manual toggle is
  // preserved. useState's initial value already covers first paint (no flash, SSR-matched).
  useEffect(() => { setCollapsedState(initialCollapsed); }, [initialCollapsed]);

  const setCollapsed = useCallback((v: boolean) => setCollapsedState(v), []);

  const toggle = useCallback(() => {
    if (isDesktop()) setCollapsedState(!collapsedRef.current);
    else setMobileOpen((o) => !o);
  }, []);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  return <Ctx.Provider value={{ collapsed, mobileOpen, hydrated: true, toggle, closeMobile, setCollapsed }}>{children}</Ctx.Provider>;
}

export function useSidebar(): SidebarState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSidebar must be used within SidebarProvider');
  return v;
}

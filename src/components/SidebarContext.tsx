'use client';
// §13.22 Collapsible navigation state, shared between the header toggle (hamburger) and the sidebar.
// Desktop: the sidebar docks and collapses to a slim icon rail (persisted). Mobile: it opens as an
// overlay drawer. One toggle drives both, picking the behaviour from the viewport width.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

interface SidebarState {
  collapsed: boolean;            // desktop icon-rail
  mobileOpen: boolean;           // mobile overlay drawer
  hydrated: boolean;             // true once the persisted value is read (avoids a flash)
  toggle: () => void;            // hamburger: collapse on desktop, open/close drawer on mobile
  closeMobile: () => void;
  setCollapsed: (v: boolean) => void;
}

const Ctx = createContext<SidebarState | null>(null);
const KEY = 'ecs.sidebarCollapsed';
const isDesktop = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsedState] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;

  useEffect(() => {
    try { if (localStorage.getItem(KEY) === '1') setCollapsedState(true); } catch { /* private mode */ }
    setHydrated(true);
  }, []);

  const setCollapsed = useCallback((v: boolean) => {
    setCollapsedState(v);
    try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ }
  }, []);

  const toggle = useCallback(() => {
    if (isDesktop()) setCollapsed(!collapsedRef.current);
    else setMobileOpen((o) => !o);
  }, [setCollapsed]);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  return <Ctx.Provider value={{ collapsed, mobileOpen, hydrated, toggle, closeMobile, setCollapsed }}>{children}</Ctx.Provider>;
}

export function useSidebar(): SidebarState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSidebar must be used within SidebarProvider');
  return v;
}

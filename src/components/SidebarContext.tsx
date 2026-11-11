'use client';
// §13.22 Navigation state, shared between the header toggle (hamburger) and the sidebar.
// Desktop: the sidebar has three states, driven by the §4.1 profile preference:
//   'shown'  — docked full width (icons + labels)
//   'icons'  — slim icon rail (icons only, labels hidden)
//   'hidden' — removed entirely
// Mobile: it opens as an overlay drawer regardless.
//
// §4.1 The DEFAULT desktop state is a per-staff profile preference read server-side by the Shell and
// passed in as `initialMode`. The hamburger overrides it for the current session: it toggles between
// the full menu and the preference's compact state (the icon rail, or hidden when the preference is
// 'hidden'). A reload, a persona switch, or saving the preference returns to the profile default, so
// the preference owns the default and there is no localStorage copy to go stale against it.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

export type SidebarMode = 'shown' | 'icons' | 'hidden';

interface SidebarState {
  mode: SidebarMode;             // desktop rendering state
  collapsed: boolean;            // convenience: mode !== 'shown'
  mobileOpen: boolean;           // mobile overlay drawer
  hydrated: boolean;             // retained for API stability (always true after mount)
  toggle: () => void;            // hamburger: desktop full <-> compact; mobile open/close drawer
  closeMobile: () => void;
  setMode: (m: SidebarMode) => void;
}

const Ctx = createContext<SidebarState | null>(null);
const isDesktop = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;

// The non-full state the hamburger toggles to: hidden when that is the profile default, else the rail.
const compactOf = (initial: SidebarMode): SidebarMode => (initial === 'hidden' ? 'hidden' : 'icons');

export function SidebarProvider({ children, initialMode = 'shown' }: { children: React.ReactNode; initialMode?: SidebarMode }) {
  const [mode, setModeState] = useState<SidebarMode>(initialMode);
  const [mobileOpen, setMobileOpen] = useState(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const compactRef = useRef(compactOf(initialMode));
  compactRef.current = compactOf(initialMode);

  // Apply the profile default whenever it changes server-side (persona switch, or the preference is
  // saved on the Staff Profile page). On ordinary navigation it is unchanged, so a manual toggle is
  // preserved. useState's initial value already covers first paint (no flash, SSR-matched).
  useEffect(() => { setModeState(initialMode); }, [initialMode]);

  const setMode = useCallback((m: SidebarMode) => setModeState(m), []);

  const toggle = useCallback(() => {
    if (isDesktop()) setModeState(modeRef.current === 'shown' ? compactRef.current : 'shown');
    else setMobileOpen((o) => !o);
  }, []);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  return (
    <Ctx.Provider value={{ mode, collapsed: mode !== 'shown', mobileOpen, hydrated: true, toggle, closeMobile, setMode }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSidebar(): SidebarState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSidebar must be used within SidebarProvider');
  return v;
}

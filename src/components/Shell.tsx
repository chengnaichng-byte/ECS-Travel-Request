// Common ECS shell (§4.1 / §13.22): a white app header with the NTU mark and the
// application title in ECS red, the user/avatar menu on the right; a light-grey left
// navigation with the active item in red; and disabled nav stubs for the ECS admin
// screens the prototype deliberately omits (§13.18).
import Link from 'next/link';
import { PersonaSwitcher } from './PersonaSwitcher';
import { NavLinks, type NavItem } from './NavLinks';
import { currentPersona, currentRoleId } from '@/shared/session';
import { PERSONA_ROLES, peopleByRole, defaultRoleFor } from '@/data/personaRoles';
import { ROLE } from '@/shared/enums';

// Existing ECS Reporting Dashboard screen (not rebuilt in the prototype) — opened in the ECS app.
const ECS_REPORTING_DASHBOARD_URL = 'https://apps.ntu.edu.sg/ECS/ReportingDashboard';

const NAV: NavItem[] = [
  { href: '/staff-profile', label: 'Staff Profile', icon: '§' },
  { href: '/dashboard', label: 'Travel Request Dashboard', icon: '▤' },
  { href: '/approvals', label: 'RO / DOA Dashboard', icon: '✓' },
  // Reporting Dashboard — the existing ECS reporting screen (opens in ECS); groups the TR
  // administration / finance surfaces beneath it.
  { href: ECS_REPORTING_DASHBOARD_URL, label: 'Reporting Dashboard', icon: '▦', external: true, children: [
    { href: '/workbench', label: 'Travel Administration', icon: '⚑' },
    { href: '/finance', label: 'Finance Oversight', icon: '$' },
    { href: '/finance/cta-charges', label: 'CTA Charges', icon: '◉' },
    { href: '/finance/cta-postings', label: 'CTA Accounting Entries', icon: '≡' },
  ] },
  { href: '/reports', label: 'Reporting', icon: '▥' },
  { href: '/visa-letters', label: 'Visa Letters', icon: '✉' },
];

const STUBS = ['GST Codes', 'Entertainment Tier', 'Mileage', 'CTC Cards', 'Rejection Reasons', 'Employee Tier', 'Define Research WBS', 'Announcements'];

export async function Shell({ children }: { children: React.ReactNode }) {
  const persona = await currentPersona();
  const roleId = (await currentRoleId()) ?? defaultRoleFor(persona.id);
  const roles = PERSONA_ROLES.map((r) => ({ key: r.key, label: r.label, note: r.note, stage: r.stage }));
  const isSysAdmin = persona.roles.includes(ROLE.SystemAdmin);
  // Separation of duties: the RO / DOA Dashboard is only for personas that hold an approver role.
  // A Travel/System Administrator (not also an approver) does not see the approval surface.
  const isApprover = ([ROLE.RO, ROLE.DOA, ROLE.ResearchDOA, ROLE.ExceptionApprover] as string[]).some((r) => persona.roles.includes(r as never));
  // Create Travel Request is subsumed under the Travel Request Dashboard (the "＋ Create Travel
  // Request" button there, gated by the same creation-remit rule — DD-24).
  const nav = NAV.filter((n) => n.href !== '/approvals' || isApprover);
  const initials = persona.name.split(' ').map((w) => w[0]).slice(-2).join('');

  return (
    <div className="min-h-full flex flex-col">
      {/* White application header — NTU mark + red title + user menu (§13.22) */}
      <header className="bg-white border-b-2 border-[var(--ecs-red)]">
        <div className="flex items-center justify-between gap-2 px-4 h-16">
          <Link href="/" className="flex items-center gap-3 min-w-0">
            <span className="inline-flex items-center justify-center w-9 h-9 shrink-0 rounded-full border-2 border-[var(--ecs-navy)] text-[var(--ecs-navy)] font-bold text-[11px]">NTU</span>
            <span className="text-[var(--ecs-red)] font-bold tracking-tight text-sm sm:text-lg uppercase leading-tight truncate">NTU Travel &amp; Expense Claim System</span>
          </Link>
          <div className="flex items-center gap-3">
            {/* §13.22 Notifications bell — moved from the sidebar into the top bar. */}
            <Link href="/notifications" aria-label="Notifications" className="relative inline-flex items-center justify-center w-9 h-9 rounded-full bg-[var(--ecs-panel)] border border-[var(--ecs-border)] text-[var(--ecs-navy)] hover:bg-[var(--ecs-panel-2)]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
              <span className="absolute top-1.5 right-2 w-2 h-2 rounded-full bg-[var(--ecs-red)] border border-white" />
            </Link>
            {/* Key on the committed persona so the switcher remounts (fresh dropdown state) whenever the
                persona changes server-side — e.g. a demo-scenario button sets the cookie and redirects.
                Without this, the client component keeps its stale useState until a full reload. */}
            <PersonaSwitcher key={`${roleId}:${persona.id}`} role={roleId} person={persona.id} roles={roles} peopleByRole={peopleByRole()} />
            <div className="hidden md:flex items-center gap-2 pl-3 border-l border-[var(--ecs-border)]">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-[var(--ecs-panel)] text-[var(--ecs-navy)] text-xs font-semibold">{initials}</span>
              <div className="flex flex-col leading-tight">
                <span className="text-sm font-medium text-[var(--ecs-text)]">{persona.name}</span>
                <span className="text-[10px] text-[var(--ecs-muted)]">{persona.roles.join(' · ')}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Left navigation */}
        <aside className="w-60 shrink-0 bg-white border-r border-[var(--ecs-border)] hidden md:flex md:flex-col">
          <nav className="p-2 space-y-0.5">
            <NavLinks items={nav} />
          </nav>
          <div className="px-3 pt-4 pb-2 mt-2 border-t border-[var(--ecs-border)]">
            <p className="text-[10px] uppercase tracking-wide text-[var(--ecs-muted)] mb-1">Setup &amp; Maintenance</p>
            <div className="mb-1"><NavLinks items={[
              ...(isSysAdmin ? [{ href: '/settings', label: 'Pre-Trip Module Settings', icon: '⚙' }] : []),
              { href: '/integration', label: 'Integration Contracts', icon: '⇄' },
              { href: '/config-viewer', label: 'Configuration Viewer', icon: '☰' },
              { href: '/setup/cta-accounts', label: 'CTA Accounts (DD-30)', icon: '▣' },
              { href: '/setup/policy-groups', label: 'Travel Policy Groups (M6)', icon: '◎' },
              { href: '/setup/upgrade-accounts', label: 'M6 Differential Accounts', icon: '▲' },
              { href: '/setup/upgrade-rates', label: 'Class Uplift Rates', icon: '％' },
              { href: '/setup/workflow', label: 'Workflow Configuration (TR)', icon: '⇄' },
              { href: '/setup/policy', label: 'Policy Configuration (TR)', icon: '§' },
              { href: '/setup/purpose-items', label: 'Purpose Cost Items', icon: '▤' },
              { href: '/setup/academic-calendar', label: 'Academic Calendar', icon: '▦' },
            ]} /></div>
            <ul className="space-y-0.5">
              {STUBS.map((s) => (
                <li key={s} className="flex items-center gap-2.5 px-3 py-1.5 rounded text-sm text-slate-400 cursor-not-allowed select-none" title="Existing ECS screen — not rebuilt in the prototype (§13.18)">
                  <span className="w-4 text-center">·</span>{s}
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <main className="flex-1 min-w-0 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

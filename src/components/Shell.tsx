// Common ECS shell (§4.1 / §13.22): a white app header with the NTU mark and the
// application title in ECS red, the user/avatar menu on the right; a light-grey left
// navigation with the active item in red; and disabled nav stubs for the ECS admin
// screens the prototype deliberately omits (§13.18).
import Link from 'next/link';
import { PersonaSwitcher } from './PersonaSwitcher';
import { NavLinks, type NavItem } from './NavLinks';
import { currentPersona, currentRoleId } from '@/shared/session';
import { PERSONA_ROLES, peopleByRole, defaultRoleFor } from '@/data/personaRoles';
import { canCreateTravelRequest } from '@/modules/pretrip/guards';
import { ROLE } from '@/shared/enums';

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Travel Request Dashboard', icon: '▤' },
  { href: '/requests/new', label: 'Create Travel Request', icon: '＋' },
  { href: '/approvals', label: 'RO / DOA Dashboard', icon: '✓' },
  { href: '/workbench', label: 'Travel Administration', icon: '⚑' },
  { href: '/finance', label: 'Finance Oversight', icon: '$' },
  { href: '/finance/cta-charges', label: 'CTA Charges', icon: '◉' },
  { href: '/finance/cta-postings', label: 'CTA Accounting Entries', icon: '≡' },
  { href: '/reports', label: 'Reporting', icon: '▦' },
  { href: '/policy', label: 'Travel Policy', icon: '§' },
  { href: '/visa-letters', label: 'Visa Letters', icon: '✉' },
  { href: '/notifications', label: 'Notifications', icon: '🔔' },
  { href: '/integration', label: 'Integration Contracts', icon: '⇄' },
  { href: '/config-viewer', label: 'Configuration Viewer', icon: '☰' },
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
  // Separation of duties (DD-24): only a persona with a creation remit (traveller / delegate / PA /
  // Travel Administrator) sees "Create Travel Request"; an approver-only persona (e.g. a DOA) does not.
  const canCreate = canCreateTravelRequest(persona.id);
  const nav = NAV.filter((n) => (n.href !== '/approvals' || isApprover) && (n.href !== '/requests/new' || canCreate));
  const initials = persona.name.split(' ').map((w) => w[0]).slice(-2).join('');

  return (
    <div className="min-h-full flex flex-col">
      {/* White application header — NTU mark + red title + user menu (§13.22) */}
      <header className="bg-white border-b-2 border-[var(--ecs-red)]">
        <div className="flex items-center justify-between gap-2 px-4 h-16">
          <Link href="/dashboard" className="flex items-center gap-3 min-w-0">
            <span className="inline-flex items-center justify-center w-9 h-9 shrink-0 rounded-full border-2 border-[var(--ecs-navy)] text-[var(--ecs-navy)] font-bold text-[11px]">NTU</span>
            <span className="flex flex-col min-w-0">
              <span className="text-[var(--ecs-red)] font-bold tracking-tight text-sm sm:text-lg uppercase leading-tight truncate">NTU Expense Claim System</span>
              <span className="text-[var(--ecs-muted)] text-[11px] tracking-wide hidden sm:block">Pre-Trip Travel Request module</span>
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <PersonaSwitcher role={roleId} person={persona.id} roles={roles} peopleByRole={peopleByRole()} />
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
            {isSysAdmin && <NavLinks items={[{ href: '/settings', label: 'Pre-Trip Module Settings', icon: '⚙' }]} />}
          </nav>
          <div className="px-3 pt-4 pb-2 mt-2 border-t border-[var(--ecs-border)]">
            <p className="text-[10px] uppercase tracking-wide text-[var(--ecs-muted)] mb-1">Setup &amp; Maintenance</p>
            <div className="mb-1"><NavLinks items={[
              { href: '/setup/provosts', label: 'Provost List (guest upgrades)', icon: '◈' },
              { href: '/setup/cta-accounts', label: 'CTA Accounts (DD-30)', icon: '▣' },
              { href: '/setup/upgrade-accounts', label: 'Upgrade Differential (M6) Accounts', icon: '▲' },
              { href: '/setup/upgrade-rates', label: 'Upgrade Uplift Rates', icon: '％' },
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

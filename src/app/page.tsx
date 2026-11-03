// §13.22 Home — an additive tile launcher into the major areas, alongside the unchanged left menu.
// Per-tile permission gating; three tile states: live (arrow), ECS placeholder (lock), not-yet-built
// (clock). End-user build: raise/track a travel request, claims (ECS placeholders), approvals (gated),
// announcements (placeholder), policy and profile.
import Link from 'next/link';
import { currentPersona } from '@/shared/session';
import { ROLE } from '@/shared/enums';

export const dynamic = 'force-dynamic';

const ECS_URL = 'https://apps.ntu.edu.sg/ECS';

type State = 'live' | 'ecs' | 'soon';
interface Tile { title: string; desc: string; href: string; external?: boolean; state: State; tint: string; ink: string; icon: React.ReactNode; show: boolean }

const I = (d: string) => <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: d }} />;
const ICON = {
  raiseTR: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="M9 15h6"/>',
  myTR: '<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 14l2 2 4-4"/>',
  receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1V2l-2 1-2-1-2 1-2-1-2 1-2-1z"/><path d="M8 7h8M8 11h8M8 15h5"/>',
  wallet: '<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h16a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5"/><path d="M17 13h.01"/>',
  approve: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 12l2 2 4-4"/>',
  megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15 8a5 5 0 0 1 0 8"/><path d="M18 5a9 9 0 0 1 0 14"/>',
  policy: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h7M9 11h7"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
};

function tiles(name: string, isApprover: boolean): Tile[] {
  return [
    { title: 'Raise a travel request', desc: 'Start a new pre-trip request', href: '/requests/new', state: 'live', tint: '#e6f1fb', ink: '#185fa5', icon: I(ICON.raiseTR), show: true },
    { title: 'My travel requests', desc: 'Track your requests and TE claim status', href: '/dashboard', state: 'live', tint: '#e1f5ee', ink: '#0f6e56', icon: I(ICON.myTR), show: true },
    { title: 'Raise an expense claim', desc: 'Travel (TE) or general (GE) — opens in ECS', href: ECS_URL, external: true, state: 'ecs', tint: '#fbeaf0', ink: '#993556', icon: I(ICON.receipt), show: true },
    { title: 'My claims', desc: 'Your TE and GE claims — opens in ECS', href: ECS_URL, external: true, state: 'ecs', tint: '#fbeaf0', ink: '#993556', icon: I(ICON.wallet), show: true },
    { title: 'Awaiting my approval', desc: 'Requests waiting on your decision', href: '/approvals', state: 'live', tint: '#faeeda', ink: '#854f0b', icon: I(ICON.approve), show: isApprover },
    { title: 'Announcements', desc: 'Travel notices and policy updates', href: '#', state: 'soon', tint: '#fcf3d6', ink: '#7a5a00', icon: I(ICON.megaphone), show: true },
    { title: 'Find a policy', desc: 'Travel policy and your entitlements', href: '/policy', state: 'live', tint: '#eaf3de', ink: '#3b6d11', icon: I(ICON.policy), show: true },
    { title: 'My profile', desc: 'Your details, grade and default charging', href: '/staff-profile', state: 'live', tint: '#eeedfe', ink: '#3c3489', icon: I(ICON.user), show: true },
  ];
}

function TileCard({ t }: { t: Tile }) {
  const inner = (
    <>
      <span className="absolute top-3.5 right-3.5">
        {t.state === 'live' && <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--ecs-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8" /></svg>}
        {t.state === 'ecs' && <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-[var(--ecs-panel)] border border-[var(--ecs-border)] text-[var(--ecs-muted)]"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>ECS</span>}
        {t.state === 'soon' && <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-[var(--ecs-panel)] border border-[var(--ecs-border)] text-[var(--ecs-muted)]"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>Soon</span>}
      </span>
      <span className="inline-flex items-center justify-center w-10 h-10 rounded-[10px]" style={{ background: t.tint, color: t.ink }}>{t.icon}</span>
      <div>
        <div className="text-[15px] font-semibold text-[var(--ecs-navy)] leading-tight">{t.title}</div>
        <div className="text-[13px] text-[var(--ecs-muted)] mt-1 leading-snug">{t.desc}</div>
      </div>
    </>
  );
  const base = 'relative flex flex-col gap-2.5 min-h-[118px] rounded-xl border border-[var(--ecs-border)] bg-white p-4';
  if (t.state === 'live') {
    return <Link href={t.href} className={`${base} hover:border-[var(--ecs-navy-2)] hover:shadow-sm transition`}>{inner}</Link>;
  }
  if (t.state === 'ecs') {
    return <a href={t.href} target="_blank" rel="noopener noreferrer" className={`${base} hover:border-[var(--ecs-navy-2)] transition`} title="Opens the ECS expense-claim system">{inner}</a>;
  }
  return <div className={`${base} cursor-not-allowed`} aria-disabled="true" title="Not yet built in this prototype">{inner}</div>;
}

export default async function Home() {
  const persona = await currentPersona();
  const isApprover = ([ROLE.RO, ROLE.DOA, ROLE.ResearchDOA, ROLE.ExceptionApprover] as string[]).some((r) => persona.roles.includes(r as never));
  const hr = new Date().getHours();
  const greeting = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const shown = tiles(persona.name, isApprover).filter((t) => t.show);

  return (
    <div className="w-full">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-[var(--ecs-navy)]">{greeting}, {persona.name}</h1>
        <p className="text-sm text-[var(--ecs-muted)] mt-0.5">{persona.title}{persona.roles.length ? ` · ${persona.roles[0]}` : ''} — what would you like to do?</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {shown.map((t) => <TileCard key={t.title} t={t} />)}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--ecs-muted)]">
        <span className="inline-flex items-center gap-1"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>ECS = opens in the claim system.</span>
        <span className="inline-flex items-center gap-1"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>Soon = not yet built.</span>
        <span>The left menu still takes you everywhere.</span>
      </div>
    </div>
  );
}

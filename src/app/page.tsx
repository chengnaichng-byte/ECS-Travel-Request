// §13.22 Home — a journey-ordered launcher into the major areas, alongside the (collapsible) left menu.
// A live status band pulls the user to their next action; an upcoming-trip card surfaces the next trip;
// tiles are grouped by the travel lifecycle (plan & request -> claim & settle -> account); external
// systems (ECS, TMC, Workday) are grouped and marked as opening elsewhere. Per-tile permission gating.
import Link from 'next/link';
import { currentPersona, currentPersonaId } from '@/shared/session';
import { ROLE, REQUEST_STATUS, BOOKING_STATUS } from '@/shared/enums';
import { listRequests } from '@/modules/pretrip/queries';
import { EcsReference, EcsIdentity } from '@/shared/ecs/services';
import { travellerName } from '@/modules/pretrip/traveller';

export const dynamic = 'force-dynamic';

const ECS_URL = 'https://apps.ntu.edu.sg/ECS';
const ECS_REPORTING_URL = 'https://apps.ntu.edu.sg/ECS/ReportingDashboard';

type State = 'live' | 'ecs' | 'soon';
interface Tile { title: string; desc: string; href: string; external?: boolean; state: State; tint: string; ink: string; icon: React.ReactNode; show: boolean; group: string }

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
  plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3.5s-2.5 0-4 1.5L13.5 8.5 5.2 6.8c-.6-.1-.9.1-1.1.5l-.3.5c-.2.4-.1.9.3 1.1L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 2.3 4.8c.2.4.7.5 1.1.3l.5-.3c.4-.2.6-.5.5-1.1z"/>',
};

function statHref(key: string) { return `/dashboard?view=${key}`; }

function TileCard({ t }: { t: Tile }) {
  const inner = (
    <>
      <span className="absolute top-3.5 right-3.5">
        {t.state === 'live' && <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--ecs-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8" /></svg>}
        {t.state === 'ecs' && <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-[var(--ecs-panel)] border border-[var(--ecs-border)] text-[var(--ecs-muted)]"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8" /></svg>ECS</span>}
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
  if (t.state === 'live') return <Link href={t.href} className={`${base} hover:border-[var(--ecs-navy-2)] hover:shadow-sm transition`}>{inner}</Link>;
  if (t.state === 'ecs') return <a href={t.href} target="_blank" rel="noopener noreferrer" className={`${base} hover:border-[var(--ecs-navy-2)] transition`} title="Opens the ECS expense-claim system">{inner}</a>;
  return <div className={`${base} cursor-not-allowed`} aria-disabled="true" title="Not yet built in this prototype">{inner}</div>;
}

export default async function Home() {
  const [persona, personaId, requests] = await Promise.all([currentPersona(), currentPersonaId(), listRequests()]);
  const isApprover = ([ROLE.RO, ROLE.DOA, ROLE.ResearchDOA, ROLE.ExceptionApprover] as string[]).some((r) => persona.roles.includes(r as never));
  const isAdmin = EcsIdentity.hasRole(personaId, 'TRAVEL_ADMIN') || EcsIdentity.hasRole(personaId, 'SYSTEM_ADMIN');
  const hr = new Date().getHours();
  const greeting = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';

  // Live status band — the viewer's own trips (an administrator sees all), same buckets as the dashboard.
  const scoped = isAdmin ? requests : requests.filter((r) =>
    r.requestorId === personaId || r.travellerId === personaId || r.travellers.some((t) => t.employeeId === personaId));
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const drafts = scoped.filter((r) => r.status === REQUEST_STATUS.Draft || r.status === REQUEST_STATUS.SentBack);
  const pending = scoped.filter((r) => r.status.startsWith('Pending'));
  const approvedUnbooked = scoped.filter((r) => r.status === REQUEST_STATUS.Approved && r.bookingStatus === BOOKING_STATUS.NotSent);
  const toClaim = scoped.filter((r) => r.status === REQUEST_STATUS.Approved && r.bookingStatus !== BOOKING_STATUS.NotSent && !(r.claims && r.claims.length));
  const upcoming = scoped.filter((r) => r.status === REQUEST_STATUS.Approved && r.startDate && r.startDate >= today0)
    .sort((a, b) => (a.startDate!.getTime()) - (b.startDate!.getTime()));

  const stats = [
    { key: 'drafts', label: 'Drafts to finish', value: drafts.length, ink: '#854f0b' },
    { key: 'pending', label: 'Awaiting approval', value: pending.length, ink: '#185fa5' },
    { key: 'unbooked', label: 'Approved, not booked', value: approvedUnbooked.length, ink: '#0f6e56' },
    { key: 'toclaim', label: 'Completed, to claim', value: toClaim.length, ink: '#993556' },
    { key: 'upcoming', label: 'Upcoming trips', value: upcoming.length, ink: '#3c3489' },
  ];

  const next = upcoming[0];
  const nextDest = next ? (EcsReference.city(next.destCity ?? '')?.name ?? next.destCountry ?? 'Destination to be set') : null;
  const fmt = (d: Date | null) => d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  const tiles: Tile[] = [
    // Plan & request
    { group: 'Plan & request', title: 'Raise a travel request', desc: 'Start a new pre-trip request', href: '/requests/new', state: 'live', tint: '#e6f1fb', ink: '#185fa5', icon: I(ICON.raiseTR), show: true },
    { group: 'Plan & request', title: 'My travel requests', desc: 'Track status, approvals and bookings', href: '/dashboard', state: 'live', tint: '#e1f5ee', ink: '#0f6e56', icon: I(ICON.myTR), show: true },
    { group: 'Plan & request', title: 'Find a policy', desc: 'Travel policy and your entitlements', href: '/policy', state: 'live', tint: '#eaf3de', ink: '#3b6d11', icon: I(ICON.policy), show: true },
    // Approvals (approver only)
    { group: 'Approvals', title: 'Awaiting my approval', desc: 'Requests waiting on your decision', href: '/approvals', state: 'live', tint: '#faeeda', ink: '#854f0b', icon: I(ICON.approve), show: isApprover },
    // Claim & settle
    { group: 'Claim & settle', title: 'Raise an expense claim', desc: 'Travel (TE) or general (GE) claim', href: ECS_URL, external: true, state: 'ecs', tint: '#fbeaf0', ink: '#993556', icon: I(ICON.receipt), show: true },
    { group: 'Claim & settle', title: 'My claims', desc: 'Track your TE and GE claims', href: ECS_URL, external: true, state: 'ecs', tint: '#fbeaf0', ink: '#993556', icon: I(ICON.wallet), show: true },
    // Your account
    { group: 'Your account', title: 'My profile', desc: 'Your details, grade and default charging', href: '/staff-profile', state: 'live', tint: '#eeedfe', ink: '#3c3489', icon: I(ICON.user), show: true },
    { group: 'Your account', title: 'Announcements', desc: 'Travel notices and policy updates', href: '#', state: 'soon', tint: '#fcf3d6', ink: '#7a5a00', icon: I(ICON.megaphone), show: true },
  ];
  const groups = ['Plan & request', 'Approvals', 'Claim & settle', 'Your account']
    .map((g) => ({ g, items: tiles.filter((t) => t.group === g && t.show) }))
    .filter((x) => x.items.length);

  const extSystems = [
    { label: 'ECS claim system', note: 'Expense claims (TE / GE)', href: ECS_URL, live: true },
    { label: 'Reporting Dashboard', note: 'Existing ECS reports', href: ECS_REPORTING_URL, live: true },
    { label: 'Travel booking (TMC)', note: 'Online booking tool', href: '#', live: false },
    { label: 'Workday', note: 'Cost objects & charging', href: '#', live: false },
  ];

  return (
    <div className="w-full max-w-6xl">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-[var(--ecs-navy)]">{greeting}, {persona.name}</h1>
        <p className="text-sm text-[var(--ecs-muted)] mt-0.5">{persona.title}{persona.roles.length ? ` · ${persona.roles[0]}` : ''} — here is where your trips stand.</p>
      </div>

      {/* Live status band — click a count to open that bucket on the dashboard. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
        {stats.map((s) => (
          <Link key={s.key} href={statHref(s.key)} className="group rounded-xl border border-[var(--ecs-border)] bg-white p-4 hover:border-[var(--ecs-navy-2)] hover:shadow-sm transition">
            <div className="text-3xl font-semibold tabular-nums" style={{ color: s.value ? s.ink : 'var(--ecs-muted)' }}>{s.value}</div>
            <div className="text-xs text-[var(--ecs-muted)] mt-1 leading-snug">{s.label}</div>
          </Link>
        ))}
      </div>

      {/* Upcoming-trip card — the soonest approved trip. */}
      {next && (
        <Link href={`/requests/${next.id}/details`} className="flex items-center gap-4 rounded-xl border border-[var(--ecs-border)] bg-gradient-to-r from-[#f3f6fc] to-white p-4 mb-6 hover:border-[var(--ecs-navy-2)] hover:shadow-sm transition">
          <span className="inline-flex items-center justify-center w-11 h-11 rounded-[10px] shrink-0" style={{ background: '#e6f1fb', color: '#185fa5' }}>{I(ICON.plane)}</span>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wide text-[var(--ecs-muted)]">Next trip</div>
            <div className="text-[15px] font-semibold text-[var(--ecs-navy)] leading-tight truncate">{nextDest} · {travellerName(next)}</div>
            <div className="text-[13px] text-[var(--ecs-muted)] mt-0.5">{fmt(next.startDate)} to {fmt(next.endDate)} · {next.bookingStatus === BOOKING_STATUS.NotSent ? 'Approved, awaiting booking' : `Booking: ${next.bookingStatus}`}</div>
          </div>
          <span className="hidden sm:inline text-sm text-[var(--ecs-navy-2)] font-medium shrink-0">View trip →</span>
        </Link>
      )}

      {/* Journey-grouped tiles */}
      <div className="space-y-6">
        {groups.map(({ g, items }) => (
          <section key={g}>
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ecs-muted)] mb-2">{g}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {items.map((t) => <TileCard key={t.title} t={t} />)}
            </div>
          </section>
        ))}
      </div>

      {/* Other systems — links that leave this app. */}
      <section className="mt-7">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ecs-muted)] mb-2">Other systems</h2>
        <div className="flex flex-wrap gap-2">
          {extSystems.map((x) => x.live ? (
            <a key={x.label} href={x.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-[var(--ecs-border)] bg-white px-3 py-2 text-sm hover:border-[var(--ecs-navy-2)] transition">
              <span className="font-medium text-[var(--ecs-navy)]">{x.label}</span>
              <span className="text-xs text-[var(--ecs-muted)]">{x.note}</span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--ecs-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6" /><path d="M10 14 21 3" /></svg>
            </a>
          ) : (
            <span key={x.label} className="inline-flex items-center gap-2 rounded-lg border border-dashed border-[var(--ecs-border)] bg-[var(--ecs-panel)] px-3 py-2 text-sm cursor-default" title="External system — link configured per deployment">
              <span className="font-medium text-[var(--ecs-muted)]">{x.label}</span>
              <span className="text-xs text-[var(--ecs-muted)]">{x.note}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--ecs-border)] text-[var(--ecs-muted)]">per deployment</span>
            </span>
          ))}
        </div>
      </section>

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--ecs-muted)]">
        <span className="inline-flex items-center gap-1"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8" /></svg>ECS = opens in the claim system.</span>
        <span className="inline-flex items-center gap-1"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>Soon = not yet built.</span>
        <span>Use the menu button (top-left) to collapse or open the side menu.</span>
      </div>
    </div>
  );
}

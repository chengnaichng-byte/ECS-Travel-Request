// §13.22 Home — a journey-ordered launcher into the major areas, alongside the (collapsible) left menu.
// A live status band pulls the user to their next action; an upcoming-trip card surfaces the next trip;
// tiles are grouped by the travel lifecycle (plan & request -> claim & settle -> account); external
// systems (ECS, TMC, Workday) are grouped and marked as opening elsewhere. Per-tile permission gating.
import Link from 'next/link';
import { currentPersona, currentPersonaId } from '@/shared/session';
import { ROLE, REQUEST_STATUS, BOOKING_STATUS, APPROVER_ROLE } from '@/shared/enums';
import { listRequests } from '@/modules/pretrip/queries';
import { prisma } from '@/shared/db';
import { EcsReference, EcsIdentity } from '@/shared/ecs/services';
import { travellerName } from '@/modules/pretrip/traveller';
import { isRequestVisibleTo } from '@/modules/pretrip/scope';

export const dynamic = 'force-dynamic';

const ECS_URL = 'https://apps.ntu.edu.sg/ECS';
const ECS_REPORTING_URL = 'https://apps.ntu.edu.sg/ECS/ReportingDashboard';

type State = 'live' | 'ecs' | 'soon' | 'ext';
interface Tile { title: string; desc: string; href: string; state: State; tint: string; ink: string; icon: React.ReactNode; show: boolean; group: string; count?: number }

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
  exception: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  additional: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  chart: '<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="5"/><rect x="12" y="8" width="3" height="9"/><rect x="17" y="5" width="3" height="12"/>',
};

const TONES = {
  info: { bg: '#e6f1fb', border: '#bcd9f5', ink: '#185fa5' },
  warning: { bg: '#faeeda', border: '#ead7b0', ink: '#854f0b' },
  success: { bg: '#e1f5ee', border: '#a7dcc6', ink: '#0f6e56' },
} as const;

const Badge = ({ children }: { children: React.ReactNode }) => <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-[var(--ecs-panel)] border border-[var(--ecs-border)] text-[var(--ecs-muted)]">{children}</span>;
const ExtIcon = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8" /></svg>;

function TileCard({ t }: { t: Tile }) {
  const inner = (
    <>
      <span className="absolute top-3.5 right-3.5">
        {t.count != null && <span className={`inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full text-[12px] font-semibold ${t.count ? 'bg-[var(--ecs-navy)] text-white' : 'bg-[var(--ecs-panel)] text-[var(--ecs-muted)] border border-[var(--ecs-border)]'}`}>{t.count}</span>}
        {t.count == null && t.state === 'live' && <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--ecs-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8" /></svg>}
        {t.count == null && t.state === 'ecs' && <Badge><ExtIcon />ECS</Badge>}
        {t.count == null && t.state === 'ext' && <Badge><ExtIcon />Opens elsewhere</Badge>}
        {t.count == null && t.state === 'soon' && <Badge><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>Soon</Badge>}
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
  if (t.state === 'ecs') return <a href={t.href} target="_blank" rel="noopener noreferrer" className={`${base} hover:border-[var(--ecs-navy-2)] transition`} title="Opens in ECS">{inner}</a>;
  if (t.state === 'ext') return <a href={t.href} target="_blank" rel="noopener noreferrer" className={`${base} hover:border-[var(--ecs-navy-2)] transition`} title="Opens the TMC online booking tool (URL set per deployment)">{inner}</a>;
  return <div className={`${base} cursor-not-allowed`} aria-disabled="true" title="Not yet built in this prototype">{inner}</div>;
}

export default async function Home() {
  const [persona, personaId, requests] = await Promise.all([currentPersona(), currentPersonaId(), listRequests()]);
  const isApprover = ([ROLE.RO, ROLE.DOA, ROLE.ResearchDOA, ROLE.ExceptionApprover] as string[]).some((r) => persona.roles.includes(r as never));
  const isAdmin = EcsIdentity.hasRole(personaId, 'TRAVEL_ADMIN') || EcsIdentity.hasRole(personaId, 'SYSTEM_ADMIN');
  const hr = new Date().getHours();
  const greeting = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';

  // Live status band — the viewer's own trips (an administrator sees all), same buckets as the dashboard.
  // §GRP-11: every group member sees their request, via the shared isRequestVisibleTo helper.
  const scoped = isAdmin ? requests : requests.filter((r) => isRequestVisibleTo(r, personaId));
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const upcoming = scoped.filter((r) => r.status === REQUEST_STATUS.Approved && r.startDate && r.startDate >= today0)
    .sort((a, b) => (a.startDate!.getTime()) - (b.startDate!.getTime()));

  // Home announcement strip — representative travel notices. (The Announcements configuration is a stub
  // for now, so these are static; it replaces the mixed TR / TE stat band, which was easy to misread.)
  const announcements: { tone: keyof typeof TONES; message: string; href?: string; linkLabel?: string }[] = [
    { tone: 'warning', message: 'Year-end travel claims for 2026 must be submitted by 15 December 2026 to be settled in this financial year.', href: '/claims', linkLabel: 'My claims' },
    { tone: 'info', message: 'New: an expense claim can now be raised without a pre-trip Travel Request for genuine exception situations (e.g. emergency travel).', href: '/claims', linkLabel: 'My claims' },
  ];

  const next = upcoming[0];
  const nextDest = next ? (EcsReference.city(next.destCity ?? '')?.name ?? next.destCountry ?? 'Destination to be set') : null;
  const fmt = (d: Date | null) => d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  // §13.22 Awaiting-my-approval tiles (approvers only): split the pending-my-approval queue by the
  // CURRENT pending step's role type. listRequests omits approval steps, so query directly here.
  const approvalCounts = { rodoa: 0, exception: 0, additional: 0 };
  if (isApprover) {
    const approverReqs = await prisma.travelRequest.findMany({
      where: { approvalSteps: { some: { approverId: personaId, status: 'Pending' } } },
      select: { approvalSteps: { select: { seq: true, status: true, approverId: true, roleType: true }, orderBy: { seq: 'asc' } } },
    });
    for (const r of approverReqs) {
      const cur = r.approvalSteps.find((s) => s.status === 'Pending'); // first pending (seq asc) = the active step
      if (cur && cur.approverId === personaId) {
        const b = cur.roleType === APPROVER_ROLE.Exception ? 'exception' : cur.roleType === APPROVER_ROLE.AdditionalApprover ? 'additional' : 'rodoa';
        approvalCounts[b]++;
      }
    }
  }
  const isFinance = EcsIdentity.hasRole(personaId, 'FINANCE_VIEWER');
  const showReports = isAdmin || isApprover || isFinance;
  const TMC_URL = '#'; // TMC online booking tool — URL set per deployment

  const tiles: Tile[] = [
    // Awaiting my approval (approvers only) — three step-type tiles with live counts
    { group: 'Awaiting my approval', title: 'RO / DOA', desc: 'Reporting officer and DOA steps', href: '/approvals?role=rodoa', state: 'live', count: approvalCounts.rodoa, tint: '#e6f1fb', ink: '#185fa5', icon: I(ICON.approve), show: isApprover },
    { group: 'Awaiting my approval', title: 'Exception', desc: 'Policy exception approvals', href: '/approvals?role=exception', state: 'live', count: approvalCounts.exception, tint: '#faeeda', ink: '#854f0b', icon: I(ICON.exception), show: isApprover },
    { group: 'Awaiting my approval', title: 'Additional approval', desc: 'Requestor-added approver steps', href: '/approvals?role=additional', state: 'live', count: approvalCounts.additional, tint: '#eeedfe', ink: '#3c3489', icon: I(ICON.additional), show: isApprover },
    // Plan & request
    { group: 'Plan & request', title: 'Raise a travel request', desc: 'Start a new pre-trip request', href: '/requests/new', state: 'live', tint: '#e6f1fb', ink: '#185fa5', icon: I(ICON.raiseTR), show: true },
    { group: 'Plan & request', title: 'My travel requests', desc: 'Track status, approvals and bookings', href: '/dashboard', state: 'live', tint: '#e1f5ee', ink: '#0f6e56', icon: I(ICON.myTR), show: true },
    { group: 'Plan & request', title: 'Find a policy', desc: 'Travel policy and your entitlements', href: '/policy', state: 'live', tint: '#eaf3de', ink: '#3b6d11', icon: I(ICON.policy), show: true },
    // Book & travel
    { group: 'Book & travel', title: 'Book your trip (TMC)', desc: 'Online booking tool, once approved', href: TMC_URL, state: 'ext', tint: '#e6f1fb', ink: '#185fa5', icon: I(ICON.plane), show: true },
    // Claim & settle
    { group: 'Claim & settle', title: 'Raise an expense claim', desc: 'Travel (TE) or general (GE) claim', href: ECS_URL, state: 'ecs', tint: '#fbeaf0', ink: '#993556', icon: I(ICON.receipt), show: true },
    { group: 'Claim & settle', title: 'My claims', desc: 'Your Pre-Trip travel expense claims', href: '/claims', state: 'live', tint: '#fbeaf0', ink: '#993556', icon: I(ICON.wallet), show: true },
    // Your account
    { group: 'Your account', title: 'My profile', desc: 'Your details, grade and default charging', href: '/staff-profile', state: 'live', tint: '#eeedfe', ink: '#3c3489', icon: I(ICON.user), show: true },
    { group: 'Your account', title: 'Announcements', desc: 'Travel notices and policy updates', href: '#', state: 'soon', tint: '#fcf3d6', ink: '#7a5a00', icon: I(ICON.megaphone), show: true },
    // Reports (approvers / admin / finance) — the single ECS reporting hub
    { group: 'Reports', title: 'Reporting Dashboard', desc: 'All reports: admin, finance and CTA', href: ECS_REPORTING_URL, state: 'ecs', tint: '#eaf3de', ink: '#3b6d11', icon: I(ICON.chart), show: showReports },
  ];
  const groups = ['Awaiting my approval', 'Plan & request', 'Book & travel', 'Claim & settle', 'Your account', 'Reports']
    .map((g) => ({ g, items: tiles.filter((t) => t.group === g && t.show) }))
    .filter((x) => x.items.length);

  return (
    <div className="w-full max-w-6xl">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-[var(--ecs-navy)]">{greeting}, {persona.name}</h1>
        <p className="text-sm text-[var(--ecs-muted)] mt-0.5">{persona.title}{persona.roles.length ? ` · ${persona.roles[0]}` : ''} — plan, book and claim your travel, all from here.</p>
      </div>

      {/* Announcement strip — configurable travel notices (replaces the mixed TR/TE stat band). */}
      {announcements.length > 0 && (
        <div className="space-y-2 mb-5">
          {announcements.map((a, i) => {
            const t = TONES[a.tone] ?? TONES.info;
            return (
              <div key={i} className="flex items-start gap-3 rounded-xl border border-[var(--ecs-border)] border-l-4 bg-white p-3.5" style={{ borderLeftColor: t.ink }}>
                <span className="shrink-0 mt-0.5" style={{ color: t.ink }}>{I(ICON.megaphone)}</span>
                <div className="min-w-0 flex-1 text-[13px] leading-snug text-[var(--ecs-navy)]">{a.message}</div>
                {a.href && a.linkLabel && <Link href={a.href} className="shrink-0 text-[13px] font-semibold whitespace-nowrap self-center hover:underline" style={{ color: t.ink }}>{a.linkLabel} →</Link>}
              </div>
            );
          })}
        </div>
      )}

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

      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--ecs-muted)]">
        <span className="inline-flex items-center gap-1"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8" /></svg>ECS = opens in ECS.</span>
        <span className="inline-flex items-center gap-1"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>Soon = not yet built.</span>
        <span>Use the menu button (top-left) to collapse or open the side menu.</span>
      </div>
    </div>
  );
}

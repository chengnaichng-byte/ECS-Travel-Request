// Review-page sections for the OpenAI approver design. Variant-aware across
// individual / multi-leg / group travel requests. Section letters are assigned by the
// page (dynamic, no gaps). Read-oriented; interactive group editing lives in
// GroupTravellers (collapsible workbench on the detail page).
import { EcsIdentity, EcsReference, EcsCharging, EcsPolicy } from '@/shared/ecs/services';
import { fmtSgd, computeOdaTiered, type CostSummary } from '@/modules/pretrip/pricing';
import { sharedLegs, computeTravellerShares, hasPersonalExtension, travellerNightsAtCity } from '@/modules/pretrip/group';
import { guestSettlements } from '@/modules/pretrip/settlement';
import { isGuestRequest, travellerName, travellerTitle, travellerEmail, memberName, memberDeptName, isGuestMember, isStudentMember, isNonEmployeeMember } from '@/modules/pretrip/traveller';
import { exceptionViews, daysToBook } from '@/modules/pretrip/exceptions';
import { ntuUpgradeDeltaTotal, ntuUpgradeDeltaByAccount } from '@/modules/pretrip/upgrade';
import { EXPENSE_CATEGORY, POLICY_OUTCOME, APPROVER_ROLE, BOOKING_METHOD_LABEL } from '@/shared/enums';
import { bookingSummaryText, arrangementLabel, isTmcArrangement } from '@/modules/pretrip/booking';
import { ENTITY_NAME } from '@/data/organisation';
import { Card, CollapsibleCard } from './ui';
import { CostItemsTable, type CostRow, type BreakLine, type BreakField, type SummaryRow } from './CostItemsTable';
import { mainDestination } from '@/modules/pretrip/destination';
import type { FullRequest } from '@/modules/pretrip/queries';

const fmtDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '—');
const heading = (letter: string | undefined, name: string) => (letter ? `${letter}. ${name}` : name);
function durationDN(a: Date | null, b: Date | null) {
  if (!a || !b) return '';
  const days = Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
  return `${days}D/${Math.max(days - 1, 0)}N`;
}
// Days-to-book pill colour — amber once there is no runway left (0 days or overdue), green otherwise.
const daysPill = (days: number) => (days <= 0 ? 'pill-warn' : 'pill-pass');

// §13.19 Entitled / Proposed travel class — the traveller's entitlement and the class they propose,
// shown together so an approver sees any upgrade at a glance. An "above entitlement" pill flags a
// proposed cabin ranked higher than the entitlement (a policy exception).
function entitledProposedClass(req: FullRequest): React.ReactNode {
  const ent = EcsReference.travelClass(req.entitledClassId ?? '');
  const prop = EcsReference.travelClass(req.travelClassId ?? '');
  const above = (prop?.rank ?? 0) > (ent?.rank ?? 0);
  return <>{ent?.name ?? '—'} / {prop?.name ?? '—'}{above && <span className="pill-warn ml-1">above entitlement</span>}</>;
}
function primaryCharging(req: FullRequest) {
  const p = [...req.allocations].sort((a, b) => b.percent - a.percent)[0];
  if (!p) return null;
  const c = EcsCharging.code(p.chargingCode);
  return { code: p.chargingCode, name: c?.name ?? '', dept: EcsIdentity.department(c?.departmentId ?? '')?.name ?? '', pct: p.percent, research: c?.isResearch };
}

// §4.4 industry trip types. Driven by the authoritative `tripType` field (not a leg-count
// heuristic). Multi-city carries the stop count so the DOA sees the itinerary's shape at a glance.
const TRIP_TYPE_LABEL: Record<string, string> = { ONE_WAY: 'One-way', ROUND_TRIP: 'Round trip', MULTI_CITY: 'Multi-city' };
function tripTypeLabel(req: FullRequest): string {
  const base = TRIP_TYPE_LABEL[req.tripType] ?? 'Round trip';
  if (req.tripType === 'MULTI_CITY') {
    const stops = Math.max(0, sharedLegs(req).length - 1);
    return stops ? `${base} · ${stops} stop${stops > 1 ? 's' : ''}` : base;
  }
  return base;
}
/** The distinct ordered city codes of a multi-city itinerary (origin + each destination). */
function routeCityCodes(req: FullRequest): string[] {
  const legs = sharedLegs(req);
  const codes = [legs[0]?.originCode, ...legs.map((l) => l.destCode)]
    .map((c) => EcsReference.airport(c ?? '')?.cityCode ?? c)
    .filter((c): c is string => !!c);
  // collapse consecutive duplicates (e.g. a layover returning to the same city)
  return codes.filter((c, i) => c !== codes[i - 1]);
}
/** Compact destination string for the decision tile: a real route for multi-city, City/Country
 *  otherwise, degrading gracefully to "Not specified" when no destination was captured. */
function destinationText(req: FullRequest): string {
  if (req.tripType === 'MULTI_CITY') {
    const codes = routeCityCodes(req);
    if (codes.length > 1) return codes.length > 4 ? `${codes[0]} → … → ${codes[codes.length - 1]}` : codes.join(' → ');
  }
  const city = EcsReference.city(req.destCity ?? '')?.name;
  const country = req.destCountry ? EcsReference.country(req.destCountry)?.name : null;
  const text = [city, country].filter(Boolean).join(', ');
  return text || 'Not specified';
}
/** Count of distinct foreign countries on the itinerary (excludes Singapore as the base). */
function foreignCountryCount(req: FullRequest): number {
  return new Set(sharedLegs(req).map((l) => EcsReference.city(EcsReference.airport(l.destCode)?.cityCode ?? '')?.countryCode).filter((c) => c && c !== 'SG')).size;
}

function Field({ label, children, accent }: { label: string; children: React.ReactNode; accent?: boolean }) {
  return (
    <div>
      <div className={`text-xs ${accent ? 'text-[var(--ecs-navy)] font-semibold' : 'text-[var(--ecs-muted)]'} mb-0.5`}>{label}</div>
      <div className="text-sm">{children ?? '—'}</div>
    </div>
  );
}

/* ---------------------------------------------- Approval Summary (for DOA) — decision glance */
// A compact, decision-oriented summary placed below the workflow and above the detail cards so
// the DOA can decide without scrolling: who/what/where/when, how much & charged to what, the
// policy exceptions, and an explicit "You are approving" statement. Variant-aware (standard,
// cross-charge, research, group, guest). The detail cards below remain the source of truth; the
// tile chevrons and "View Full Details" scroll to them (anchors set on the request page).
const fmtPretty = (d: Date | null) => (d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

function SumTile({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-[var(--ecs-border)] bg-white p-3">
      <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-[var(--ecs-border)]">
        <div className="text-sm font-semibold text-[var(--ecs-navy)]">{title}</div>
        <a href={href} className="text-[var(--ecs-muted)] hover:text-[var(--ecs-navy)] text-sm" title="Open full details">›</a>
      </div>
      <div className="space-y-2 text-sm">{children}</div>
    </div>
  );
}
function TileRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="text-[11px] text-[var(--ecs-muted)]">{label}</div><div className="text-sm">{children ?? '—'}</div></div>;
}

export function ApprovalSummaryCard({ req, summary, bookingDeadlineDays, detailsHref }: {
  req: FullRequest; summary: CostSummary; bookingDeadlineDays: number; detailsHref: string;
}) {
  const isGuest = isGuestRequest(req);
  const emp = EcsIdentity.employee(req.travellerId);
  const hostDeptId = isGuest ? (req.departmentId ?? EcsIdentity.employee(req.requestorId)?.departmentId) : emp?.departmentId;
  const deptName = EcsIdentity.department(hostDeptId ?? '')?.name ?? '—';
  const coordinator = EcsIdentity.employee(req.requestorId)?.name ?? '—';
  const purpose = EcsReference.travelPurpose(req.purposeId ?? '')?.name ?? '—';

  // Main city/country of stay (longest-stay country + its longest-stay city) — same helper as the Trip
  // step, Review and Full Details, so all views record the same destination. Falls back to persisted.
  const md = mainDestination(sharedLegs(req));
  const mdCity = EcsReference.city(md.cityCode || (req.destCity ?? ''))?.name;
  const mdCountry = EcsReference.country(md.countryCode || (req.destCountry ?? ''))?.name;
  const destText = mdCity ? [mdCity, mdCountry].filter(Boolean).join(', ') : (mdCountry ?? destinationText(req));
  const tripType = tripTypeLabel(req);
  const foreignCountries = foreignCountryCount(req);
  const isMultiCity = req.tripType === 'MULTI_CITY';
  const dateText = `${fmtPretty(req.startDate)} – ${fmtPretty(req.endDate)}${durationDN(req.startDate, req.endDate) ? ` (${durationDN(req.startDate, req.endDate)})` : ''}`;
  const personalText = req.isGroup
    ? `${req.travellers.filter((t) => hasPersonalExtension(req, t.employeeId)).length} travellers`
    : (req.personalStart ? `${fmtPretty(req.personalStart)} – ${fmtPretty(req.personalEnd)}` : 'None');

  const { days } = daysToBook(req, bookingDeadlineDays);
  const validityEnd = req.authorisationExpiry ?? (req.startDate ? new Date(req.startDate.getTime() - bookingDeadlineDays * 86400000) : null);

  const allocs = [...req.allocations].sort((a, b) => b.percent - a.percent);
  const primary = allocs[0];
  const primaryCode = primary ? EcsCharging.code(primary.chargingCode) : null;
  const crossCharge = allocs.length > 1;
  const research = allocs.some((a) => EcsCharging.code(a.chargingCode)?.isResearch);
  // #14 the NTU-funded class-upgrade differential charges M6, so the chosen accounts carry the
  // entitlement portion (ntuFunded − delta) and M6 carries the delta.
  const m6Delta = ntuUpgradeDeltaTotal(req.expenses);
  const amountFor = (pct: number) => fmtSgd(((summary.ntuFunded - m6Delta) * pct) / 100);

  const exViews = exceptionViews(req);
  const exImpact = exViews.reduce((s, e) => s + e.impactSgd, 0);
  // §26/§DD-25 was the exception already approved upstream (Exception Approver / Provost)?
  const upstreamExStep = req.approvalSteps.find((s) => (s.roleType === APPROVER_ROLE.Exception || s.roleType === APPROVER_ROLE.Provost) && s.status === 'Approved');
  const exApproved = !!upstreamExStep;
  const exApproverName = upstreamExStep ? (EcsIdentity.employee(upstreamExStep.approverId ?? '')?.name ?? '—') : '';
  const exApproverRole = upstreamExStep?.roleType === APPROVER_ROLE.Provost ? 'Provost' : 'Exception Approver';

  // "You are approving" charging phrase
  const chargePhrase = crossCharge
    ? `split across ${allocs.map((a) => `${a.chargingCode} (${a.percent}%)`).join(', ')}`
    : `100% to ${primary?.chargingCode ?? '—'} (${primaryCode?.name ?? ''})`;
  const whoPhrase = req.isGroup
    ? `${req.travellers.length} travellers (coordinator ${coordinator})`
    : isGuest ? `guest ${travellerName(req)}${req.guestOrg ? ` of ${req.guestOrg}` : ''} hosted by ${deptName}`
    : `${travellerName(req)}`;

  const sevClass: Record<string, string> = { Low: 'pill-info', Medium: 'pill-warn', High: 'pill-stop' };

  return (
    <div className="rounded-md border border-[var(--ecs-border)] bg-[var(--ecs-panel-2)] shadow-sm p-5">
      {/* Header + status chips + view-details */}
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--ecs-navy)]">Approval Summary</h2>
          <p className="text-xs text-[var(--ecs-muted)]">Key information for decision. View the details below for full information.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {exViews.length > 0
            ? <>
                {exApproved
                  ? <span className="pill-pass">✓ {exViews.length} Exception{exViews.length > 1 ? 's' : ''} Approved</span>
                  : <span className="pill-warn">{exViews.length} Policy Exception{exViews.length > 1 ? 's' : ''}</span>}
                <span className="pill-pass">✓ All Other Checks Passed</span>
              </>
            : <span className="pill-pass">✓ All policy checks passed</span>}
          <a href={detailsHref} className="btn-secondary text-xs">View Full Details →</a>
        </div>
      </div>

      {/* 4 decision tiles */}
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <SumTile title="Traveller & Purpose" href={`${detailsHref}#sec-traveller`}>
          <div>
            <div className="font-semibold text-[var(--ecs-navy)]">{req.isGroup ? `Group travel · ${req.travellers.length} travellers` : travellerName(req)}{isGuest && <span className="pill-info ml-1">Guest</span>}</div>
            <div className="text-xs text-[var(--ecs-muted)]">
              {req.isGroup ? `Coordinator: ${coordinator}` : isGuest ? `Host: ${deptName}` : `${travellerTitle(req)} · ${deptName}`}
            </div>
            {!isGuest && !req.isGroup && <div className="text-xs text-[var(--ecs-muted)]">{ENTITY_NAME}</div>}
          </div>
          <TileRow label="Purpose">{purpose}</TileRow>
          {req.description && <TileRow label="Business justification"><span className="text-[13px]">{req.description}</span></TileRow>}
        </SumTile>

        <SumTile title="Trip Details" href={`${detailsHref}#sec-trip`}>
          <TileRow label="Trip type">{tripType}</TileRow>
          <TileRow label="Destination">
            <div>
              <div>{destText}</div>
              {isMultiCity && <div className="text-[11px] text-[var(--ecs-muted)]">{sharedLegs(req).length} legs · {foreignCountries} countr{foreignCountries === 1 ? 'y' : 'ies'}</div>}
            </div>
          </TileRow>
          {req.isGroup && <TileRow label="Travellers">{req.travellers.length}</TileRow>}
          <TileRow label="Official travel dates">{dateText}</TileRow>
          <TileRow label="Personal extension">{personalText}</TileRow>
        </SumTile>

        <SumTile title="Estimated Cost & Charging" href={`${detailsHref}#sec-cost`}>
          <div>
            <div className="text-[11px] text-[var(--ecs-muted)]">Total Estimated Trip Cost</div>
            <div className="text-xl font-bold text-[var(--ecs-navy)]">{fmtSgd(summary.gross)}</div>
            {summary.sponsorship > 0 && <div className="text-[11px] text-[var(--ecs-muted)]">NTU-funded (committed): <strong>{fmtSgd(summary.ntuFunded)}</strong> · less sponsorship {fmtSgd(summary.sponsorship)}</div>}
          </div>
          <div className="rounded border border-[var(--ecs-border)] bg-[var(--ecs-panel-2)] p-2">
            <div className="text-[11px] text-[var(--ecs-muted)]">Primary Charging Account</div>
            <div className="text-[13px] font-medium">{primary ? `${primary.chargingCode} · ${primaryCode?.name ?? ''}` : '—'}</div>
            <div className="text-[11px]">{primary ? `${primary.percent}% (${amountFor(primary.percent)})` : ''}{research && <span className="pill-warn ml-1">Research WBS</span>}</div>
          </div>
          {m6Delta > 0 && (
            <div className="rounded border border-[var(--ecs-border)] bg-[var(--ecs-panel-2)] p-2">
              <div className="text-[11px] text-[var(--ecs-muted)]">M6 entitlement differential</div>
              <div className="text-[13px] font-medium">{ntuUpgradeDeltaByAccount(req.expenses).map((m) => m.code ?? 'M6').join(', ')} <span className="pill-info ml-1">M6</span> {fmtSgd(m6Delta)}</div>
              <div className="text-[11px] text-[var(--ecs-muted)]">Funded from M6 — the Economy base stays on the account(s) above</div>
            </div>
          )}
          <TileRow label="Cross-charge">
            {crossCharge ? <span className="pill-warn">Yes · {allocs.length} accounts</span> : 'No cross-charge'}
          </TileRow>
          {crossCharge && (
            <div className="text-[11px] -mt-1">
              {/* Accounts highest-share first (allocs is sorted desc by %). With more than two accounts
                  the list is height-capped and scrolls, so the tile stays balanced with its neighbours;
                  with two it shows in full. Rows never wrap; the DOA-basis line stays below, always visible. */}
              <ul className={`space-y-0.5 pr-1 ${allocs.length > 2 ? 'max-h-24 overflow-y-auto' : ''}`}>
                {allocs.map((a) => <li key={a.id} className="flex justify-between gap-2"><span className="truncate">{a.chargingCode}{EcsCharging.code(a.chargingCode)?.isResearch ? ' (research)' : ''}</span><span className="font-medium whitespace-nowrap">{a.percent}% · {amountFor(a.percent)}</span></li>)}
              </ul>
              <div className="text-[var(--ecs-muted)] pt-0.5 mt-0.5 border-t border-[var(--ecs-border)]">DOA basis: highest-share account{primaryCode ? ` (${EcsIdentity.department(primaryCode.departmentId)?.name ?? ''})` : ''}</div>
            </div>
          )}
        </SumTile>

        <SumTile title="Travel Arrangement" href={`${detailsHref}#sec-trip`}>
          <TileRow label="Entitled / Proposed travel class">{req.isGroup ? 'Per traveller (see roster)' : entitledProposedClass(req)}</TileRow>
          <TileRow label="Booking arrangement">{bookingSummaryText(req.bookingArrangement, req.bookingMethod)}</TileRow>
          <TileRow label="Authorisation validity">
            {fmtPretty(req.createdAt)} – {fmtPretty(validityEnd)}
            <div className="mt-1"><span className={daysPill(days)}>{days} days to book</span></div>
          </TileRow>
        </SumTile>
      </div>

      {/* Policy exceptions + approval-requested */}
      <div className="grid md:grid-cols-2 gap-3 mt-3">
        {exViews.length > 0 ? (
          <div className="rounded-md border border-[#f97316] bg-[#fff3e8] p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-[#c2410c]"><span className="text-[#ea580c]" aria-hidden>⚠</span>Policy Exception{exViews.length > 1 ? 's' : ''} ({exViews.length}){exApproved && <span className="font-normal"> – Previously Approved</span>}</div>
              <a href={`${detailsHref}#sec-exceptions`} className="text-[#ea580c] hover:text-[#c2410c] text-sm" title="Jump to full details">›</a>
            </div>
            <ol className="space-y-3 text-sm">
              {exViews.map((e, i) => (
                <li key={i}>
                  <div className="flex items-center gap-2"><span className="font-medium text-[#7c2d12]">{exViews.length > 1 ? `${i + 1}. ` : ''}{e.label}</span><span className={sevClass[e.severity]}>{e.severity}</span>{e.travellerName && <span className="text-xs text-[#9a3412]/80">· {e.travellerName}</span>}</div>
                  {e.breakdown ? (
                    <div className="grid grid-cols-3 gap-2 mt-1.5">
                      <div><div className="text-[11px] text-[#9a3412]/80">{e.breakdown.leftLabel}</div><div className="text-[13px] font-medium text-[#7c2d12]">{e.breakdown.leftValue}</div></div>
                      <div><div className="text-[11px] text-[#9a3412]/80">{e.breakdown.rightLabel}</div><div className="text-[13px] font-medium text-[#7c2d12]">{e.breakdown.rightValue}</div></div>
                      <div><div className="text-[11px] text-[#9a3412]/80">Incremental impact</div><div className="text-[13px] font-semibold text-[#5a1e0a] tabular-nums">{fmtSgd(e.impactSgd)}</div></div>
                    </div>
                  ) : (
                    <>
                      {e.detail && <div className="text-xs text-[#9a3412]/80 mt-0.5">{e.detail}</div>}
                      {e.impactSgd > 0 && <div className="text-xs text-[#7c2d12] mt-0.5">Estimated incremental impact: <strong className="tabular-nums">{fmtSgd(e.impactSgd)}</strong></div>}
                    </>
                  )}
                  <div className="text-xs text-[#7c2d12] mt-1.5"><span className="font-medium">Justification:</span> {e.justification ? <span className="italic">&ldquo;{e.justification}&rdquo;</span> : <span className="text-[#9a3412]/70">— none provided</span>}</div>
                </li>
              ))}
            </ol>
            {exApproved && (
              <div className="mt-3 pt-2 border-t border-[#fbd7b8] flex items-center gap-2 text-sm">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#2f9e5f] text-white text-xs leading-none shrink-0">✓</span>
                <span className="text-[#7c2d12]">Approved by <strong>{exApproverName}</strong> ({exApproverRole})</span>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-md border border-[var(--ecs-border)] bg-white p-3">
            <div className="flex items-center gap-2 text-sm"><span className="pill-pass">Pass</span><span className="font-semibold text-[var(--ecs-navy)]">All policy checks passed</span></div>
            <div className="text-xs text-[var(--ecs-muted)] mt-1">This trip meets travel-policy requirements; no exception approval is required.</div>
          </div>
        )}

        <div className="rounded-md border border-[var(--ecs-border)] bg-white p-3">
          <div className="text-sm font-semibold text-[var(--ecs-navy)] mb-2">Approval Requested</div>
          <div className="text-xs text-[var(--ecs-muted)] mb-2">You are being asked to approve:</div>
          <div className="rounded-md border border-[#cdddf0] bg-[#eef3fa] p-3 mb-2">
            <div className="text-sm font-semibold text-[var(--ecs-navy)]">Official travel for {whoPhrase} to {destText}</div>
            <div className="text-xs text-[var(--ecs-muted)] mt-0.5">{dateText}</div>
          </div>
          <ul className="list-disc pl-5 text-sm space-y-1">
            <li>An estimated commitment of <strong>{fmtSgd(summary.ntuFunded)}</strong>{summary.sponsorship > 0 ? ` (gross ${fmtSgd(summary.gross)})` : ''} charged {chargePhrase}.</li>
            {m6Delta > 0 && <li>Includes an <strong>M6 entitlement differential</strong> of <strong>{fmtSgd(m6Delta)}</strong> (the Economy→entitled-class uplift), charged to {ntuUpgradeDeltaByAccount(req.expenses).map((m) => m.code ?? 'M6').join(', ')} — funded from M6.</li>}
            {exViews.length > 0 && (
              upstreamExStep
                ? <li>The {exViews.map((e) => e.label.toLowerCase()).join('; ')} exception{exViews.length > 1 ? 's have' : ' has'} been <strong>separately approved</strong> ({exApproverRole}).</li>
                : <li>The {exViews.map((e) => e.label.toLowerCase()).join('; ')} exception{exViews.length > 1 ? 's' : ''}{exImpact > 0 ? <> with an estimated incremental cost of <strong>{fmtSgd(exImpact)}</strong></> : ''}.</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------- top summary banner */
export function SummaryCard({ req, bookingDeadlineDays }: { req: FullRequest; bookingDeadlineDays: number }) {
  const isMulti = req.tripType === 'MULTI_CITY';
  const purpose = EcsReference.travelPurpose(req.purposeId ?? '')?.name ?? '—';
  const routeCodes = routeCityCodes(req);
  const countryCount = foreignCountryCount(req);
  const { days } = daysToBook(req, bookingDeadlineDays);
  const validityEnd = req.authorisationExpiry ?? (req.startDate ? new Date(req.startDate.getTime() - bookingDeadlineDays * 86400000) : null);
  const pc = primaryCharging(req);
  // Main city/country of STAY — the longest-stay country and its longest-stay city (same rule as the
  // Trip step and Review page, via mainDestination). Falls back to the persisted destination.
  const md = mainDestination(sharedLegs(req));
  const mdCity = EcsReference.city(md.cityCode || (req.destCity ?? ''))?.name;
  const mdCountry = EcsReference.country(md.countryCode || (req.destCountry ?? ''))?.name;
  const mdText = mdCity ? [mdCity, mdCountry].filter(Boolean).join(', ') : (mdCountry ?? destinationText(req));
  const m6Delta = ntuUpgradeDeltaTotal(req.expenses);   // #14 NTU-funded upgrade differential → M6
  const m6Accounts = m6Delta > 0 ? ntuUpgradeDeltaByAccount(req.expenses).map((m) => m.code ?? 'M6').join(', ') : '';
  const method = isTmcArrangement(req.bookingArrangement) && req.bookingMethod ? (BOOKING_METHOD_LABEL[req.bookingMethod] ?? req.bookingMethod) : '';

  // Four themed cards (same Card header/colour as the lettered cards below) — Travel Purpose,
  // Itinerary, Travel Arrangements, Charging. All fields are already-wired request data.
  return (
    <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-5 items-stretch">
      <Card title="Travel Purpose" className="h-full">
        <div className="space-y-3">
          <Field label="Travel purpose">{purpose}</Field>
          <Field label="Event / Conference">{req.description?.split('—')[0]?.trim() || '—'}</Field>
          <Field label="Business justification">{req.description ?? '—'}</Field>
        </div>
      </Card>

      <Card title="Itinerary" className="h-full">
        <div className="space-y-3">
          <Field label="Trip type">{tripTypeLabel(req)}</Field>
          <Field label="Destination">
            {mdText}
            {isMulti && routeCodes.length > 1 && <div className="mt-1"><span className="pill-navy inline-block">{sharedLegs(req).length} legs · {countryCount} countr{countryCount === 1 ? 'y' : 'ies'}</span></div>}
          </Field>
          <Field label="Official travel dates">{fmtDate(req.startDate)} – {fmtDate(req.endDate)} {durationDN(req.startDate, req.endDate) && <span className="text-[var(--ecs-muted)]">({durationDN(req.startDate, req.endDate)})</span>}</Field>
          <Field label="Personal extension">
            {req.isGroup ? `${req.travellers.filter((t) => hasPersonalExtension(req, t.employeeId)).length} travellers` : (req.personalStart ? `${fmtDate(req.personalStart)} – ${fmtDate(req.personalEnd)}` : 'None')}
          </Field>
        </div>
      </Card>

      <Card title="Travel Arrangements" className="h-full">
        <div className="space-y-3">
          <Field label={`Entitled / Proposed travel class${req.isGroup ? ' (per traveller)' : ''}`}>{req.isGroup ? 'Each at own entitlement — see roster' : entitledProposedClass(req)}</Field>
          <Field label="Booking arrangement">
            {arrangementLabel(req.bookingArrangement)}
            {method && <div className="text-[var(--ecs-muted)]">{method}</div>}
          </Field>
          <Field label="Travel authorisation validity">
            {fmtDate(req.createdAt)} – {fmtDate(validityEnd)}
            <div className="mt-1"><span className={daysPill(days)}>{days} days to book</span></div>
          </Field>
        </div>
      </Card>

      <Card title="Charging" className="h-full">
        <div className="space-y-3">
          <Field label="Primary charging account">
            {pc ? <span>{pc.code} · {pc.name} <span className="text-[var(--ecs-muted)]">({pc.pct}%{pc.research ? ' · research' : ''})</span></span> : '—'}
          </Field>
          <Field label="Additional funding">
            {m6Delta > 0 ? (
              <>
                M6 entitlement differential {fmtSgd(m6Delta)}
                <div className="text-[var(--ecs-muted)]">Funded from M6{m6Accounts ? ` · ${m6Accounts}` : ''}</div>
              </>
            ) : 'None'}
          </Field>
          {req.isGroup && <Field label="Group coordinator">{EcsIdentity.employee(req.requestorId)?.name}</Field>}
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------ Traveller / Group */
export function TravellerCard({ req, letter, className }: { req: FullRequest; letter?: string; className?: string }) {
  const guest = isGuestRequest(req);
  const t = EcsIdentity.employee(req.travellerId);
  const host = EcsIdentity.employee(req.requestorId);
  return (
    <Card title={heading(letter, guest ? 'Guest Traveller & Host' : 'Traveller & Organisation')} className={className}>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
        <Field label="Traveller">{travellerName(req)}{guest && <span className="pill-info ml-1">Guest</span>}</Field>
        <Field label={guest ? 'Affiliation' : 'Title / Position'}>{travellerTitle(req)}</Field>
        {guest ? (
          <>
            <Field label="Guest email">{travellerEmail(req) ?? '—'}</Field>
            <Field label="Charged to (host dept)">{EcsIdentity.department(req.departmentId ?? host?.departmentId ?? '')?.name ?? '—'}</Field>
            <Field label="Host / Requestor">{host?.name ?? '—'}</Field>
            <Field label="ECS profile">None (non-employee)</Field>
          </>
        ) : (
          <>
            <Field label="Worker type">{t?.workerType ?? '—'}{t?.travelEligible === false ? ' · not travel-eligible' : ''}</Field>
            <Field label="Email">{t?.email ?? '—'}</Field>
            <Field label="Employing Entity">{EcsIdentity.entity().name}</Field>
            <Field label="Department / BA">{EcsIdentity.department(t?.departmentId ?? '')?.name}{t?.businessArea ? ` · ${t.businessArea}` : ''}</Field>
            <Field label="Default charging">{t?.defaultChargingCode ?? '—'}</Field>
            <Field label="Requestor">{EcsIdentity.employee(req.requestorId)?.name}{req.requestorId !== req.travellerId ? ' (on behalf)' : ''}</Field>
            <Field label="Reporting Officer">{EcsIdentity.reportingOfficer(req.travellerId)?.name ?? '—'}</Field>
          </>
        )}
      </dl>
    </Card>
  );
}

export function GroupSummaryCard({ req, letter, className }: { req: FullRequest; letter?: string; className?: string }) {
  const shares = computeTravellerShares(req);
  const withException = new Set(req.policyChecks.filter((c) => c.outcome === POLICY_OUTCOME.Exception && c.travellerId).map((c) => c.travellerId)).size;
  const withPersonal = req.travellers.filter((t) => hasPersonalExtension(req, t.employeeId)).length;
  const total = shares.reduce((s, r) => s + r.totalSgd, 0);
  const tiles = [
    ['Total Travellers', req.travellers.length],
    ['Travellers with Exception', withException],
    ['Travellers with Personal Extension', withPersonal],
  ] as const;
  return (
    <Card title={heading(letter, 'Group Summary')} className={className}>
      <div className="grid grid-cols-3 gap-3">
        {tiles.map(([l, v]) => (
          <div key={l} className="bg-[var(--ecs-panel-2)] rounded p-3 text-center">
            <div className="text-2xl font-semibold text-[var(--ecs-navy)]">{v}</div>
            <div className="text-[11px] text-[var(--ecs-muted)] mt-1">{l}</div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-[var(--ecs-border)] mt-3 pt-3">
        <span className="text-sm font-semibold">Estimated Total Cost (SGD)</span>
        <span className="text-lg font-semibold text-[var(--ecs-navy)]">{fmtSgd(total)}</span>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------ Traveller Roster (group) */
export function TravellerRoster({ req, letter, className }: { req: FullRequest; letter?: string; className?: string }) {
  const shares = computeTravellerShares(req);
  const exceptionByTraveller = new Set(req.policyChecks.filter((c) => c.outcome === POLICY_OUTCOME.Exception && c.travellerId).map((c) => c.travellerId));
  return (
    <Card title={heading(letter, `Traveller Roster (${req.travellers.length})`)} className={className}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr>
            <th className="th">#</th><th className="th">Traveller</th><th className="th">Department</th><th className="th">Class</th>
            <th className="th">Travel Dates</th><th className="th text-right">Est. Cost (SGD)</th><th className="th">Exception</th><th className="th">Booking</th>
          </tr></thead>
          <tbody>
            {req.travellers.map((t, i) => {
              const s = shares.find((x) => x.employeeId === t.employeeId);
              const start = t.ownStartDate ?? req.startDate;
              const end = t.ownEndDate ?? req.endDate;
              return (
                <tr key={t.id} className="hover:bg-[var(--ecs-panel-2)]">
                  <td className="td">{i + 1}</td>
                  <td className="td font-medium">{memberName(t)}{t.isRequestor && <span className="pill-navy ml-1">Coord.</span>}{isStudentMember(t) ? <span className="pill-info ml-1">Student</span> : isGuestMember(t) && <span className="pill-info ml-1">Guest</span>}</td>
                  <td className="td text-xs">{memberDeptName(t)}</td>
                  <td className="td text-xs">{isNonEmployeeMember(t) ? 'Economy' : (EcsReference.travelClass(t.chosenClassId ?? t.entitledClassId ?? req.travelClassId ?? '')?.name ?? '—')}</td>
                  <td className="td whitespace-nowrap text-xs">{fmtDate(start)} – {fmtDate(end)}{t.ownStartDate && <span className="text-[var(--ecs-muted)]"> (own)</span>}</td>
                  <td className="td text-right whitespace-nowrap">{fmtSgd(s?.totalSgd ?? 0)}</td>
                  <td className="td">{exceptionByTraveller.has(t.employeeId) ? <span className="pill-exc">Yes</span> : <span className="pill-info">No</span>}</td>
                  <td className="td text-xs text-[var(--ecs-muted)]">{req.bookingStatus}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="td" colSpan={5}>Total ({req.travellers.length} travellers)</td>
              <td className="td text-right">{fmtSgd(shares.reduce((s, r) => s + r.totalSgd, 0))}</td>
              <td className="td">{exceptionByTraveller.size}</td>
              <td className="td text-xs">0 / {req.travellers.length} Booked</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

/* ------------------------------------------------ Guest settlement (host direct-billed) */
export function GuestSettlementCard({ req, letter, className }: { req: FullRequest; letter?: string; className?: string }) {
  const rows = guestSettlements(req);
  if (rows.length === 0) return null;
  const totalEst = rows.reduce((s, r) => s + r.estimatedSgd, 0);
  const totalBilled = rows.reduce((s, r) => s + (r.billedSgd ?? 0), 0);
  const anyBilled = rows.some((r) => r.billedSgd != null);
  return (
    <Card title={heading(letter, `Guest Settlement — host direct-billed (${rows.length})`)} className={className}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr>
            <th className="th">Guest</th><th className="th">Organisation</th><th className="th">Cost object (host)</th>
            <th className="th text-right">Estimate (SGD)</th><th className="th text-right">Direct-billed (SGD)</th><th className="th">Settlement</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.employeeId} className="hover:bg-[var(--ecs-panel-2)]">
                <td className="td font-medium">{r.name} <span className="pill-info ml-1">Guest</span></td>
                <td className="td text-xs">{r.org ?? '—'}</td>
                <td className="td text-xs whitespace-nowrap">{r.costObject} · {r.costObjectName}</td>
                <td className="td text-right whitespace-nowrap">{fmtSgd(r.estimatedSgd)}</td>
                <td className="td text-right whitespace-nowrap">{r.billedSgd != null ? fmtSgd(r.billedSgd) : '—'}</td>
                <td className="td text-xs">{r.source === 'TMC_DIRECT_BILL' ? <span className="pill-pass">{r.status}</span> : <span className="pill-warn">{r.status}</span>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="td" colSpan={3}>Total guest cost (host-settled)</td>
              <td className="td text-right">{fmtSgd(totalEst)}</td>
              <td className="td text-right">{anyBilled ? fmtSgd(totalBilled) : '—'}</td>
              <td className="td"></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-[var(--ecs-muted)] mt-2">
        Guests have no ECS login and file <b>no TE claim</b> (§8). Their airfare and accommodation are <b>direct-billed by the TMC to the host department</b> cost object above; the actual is read from the guest&apos;s own booking in the group fan-out (§9.3). Guests carry <b>no share of any shared line</b> and no ODA is settled through this flow.
      </p>
      {/* §8 / DD-21 PDPA — ECS never holds guest sensitive data; the TMC collects it. */}
      <div className="mt-3 rounded border border-[var(--ecs-border)] bg-[var(--ecs-panel-2)] p-3 text-xs text-[var(--ecs-muted)]">
        <div className="font-semibold text-[var(--ecs-navy)] mb-1">🔒 Guest data (PDPA) — DD-21</div>
        ECS stores the guest&apos;s <b>name, e-mail &amp; organisation only</b>. Passport, date of birth and contact details are <b>collected by the TMC</b> via a secure link e-mailed to the guest — they are never held in ECS. The booking instruction carries a <span className="font-mono">guestProfile</span> indicator (governed by the Integration Contract); see the TMC booking-instruction preview on the Integration Contracts screen.
      </div>
    </Card>
  );
}

/* ------------------------------------------------------ Itinerary legs (multi-leg) */
export function ItineraryLegsCard({ req, letter, className }: { req: FullRequest; letter?: string; className?: string }) {
  const legs = sharedLegs(req);
  const countries = [...new Set(legs.map((l) => EcsReference.country(EcsReference.city(EcsReference.airport(l.destCode)?.cityCode ?? '')?.countryCode ?? '')?.name).filter(Boolean))];
  const nights = legs.reduce((s, l) => s + l.nights, 0);
  return (
    <Card title={heading(letter, `Itinerary (${legs.length} legs)`)} className={className}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr>
            <th className="th">Leg</th><th className="th">From</th><th className="th">To</th><th className="th">Departure</th><th className="th">Arrival</th><th className="th">Class</th><th className="th">Type</th>
          </tr></thead>
          <tbody>
            {legs.map((l) => (
              <tr key={l.id} className="hover:bg-[var(--ecs-panel-2)]">
                <td className="td">{l.seq}</td>
                <td className="td font-medium">{l.originCode}</td>
                <td className="td font-medium">{l.destCode}</td>
                <td className="td whitespace-nowrap">{fmtDate(l.departDate)}</td>
                <td className="td whitespace-nowrap">{fmtDate(l.arriveDate)}</td>
                <td className="td">{EcsReference.travelClass(l.entitledClassId ?? l.travelClassId ?? '')?.name ?? '—'}</td>
                <td className="td">{l.isPersonal ? <span className="pill-info">Personal</span> : 'Official'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <Field label="Total duration">{nights + 1} days ({nights} nights)</Field>
        <Field label="Countries">{countries.join(', ')}</Field>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------ Policy Exceptions */
export function PolicyExceptionsCard({ req, letter, className }: { req: FullRequest; letter?: string; className?: string }) {
  const views = exceptionViews(req);
  if (views.length === 0) return (
    <Card title={heading(letter, 'Policy Exceptions')} className={className}>
      <div className="flex items-center gap-3 text-sm">
        <span className="inline-flex items-center gap-2 rounded-lg bg-[#e8f3ec] px-3 py-1.5">
          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#2f9e5f] text-white text-xs leading-none">✓</span>
          <span className="font-semibold text-[#2f7d4f]">Pass</span>
        </span>
        <span className="text-[var(--ecs-muted)]">No policy exceptions.</span>
      </div>
    </Card>
  );
  // Soft emphasis: a warm tinted panel with a left severity rail and a bold impact figure — clearer
  // than a plain callout, without a stark solid fill. Severity sets the hue (orange Medium, red High,
  // amber Low) on the rail, tint and pill. Full width inside the card. Whether an exception actually
  // needs approval is a routing decision (policy config), so this card does not assert it.
  const sev: Record<string, { rail: string; bg: string; border: string; text: string; pill: string }> = {
    Low:    { rail: '#f59e0b', bg: '#fffdf4', border: '#fbe7bd', text: '#92610e', pill: '#fbe6bf' },
    Medium: { rail: '#ea580c', bg: '#fff8f1', border: '#fbd7b8', text: '#9a3412', pill: '#fbddc6' },
    High:   { rail: '#dc2626', bg: '#fef5f5', border: '#f5cccf', text: '#991b1b', pill: '#f6d2d4' },
  };
  return (
    <Card title={heading(letter, `Policy Exceptions (${views.length})`)} className={className}>
      <div className="space-y-3">
        {views.map((v, i) => {
          const s = sev[v.severity] ?? sev.Medium;
          return (
            <div key={i} className="rounded-md border p-3" style={{ borderColor: s.border, borderLeftWidth: 4, borderLeftColor: s.rail, background: s.bg }}>
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold text-sm flex items-start gap-1.5" style={{ color: s.text }}><span aria-hidden className="mt-px">⚠</span><span>{v.label}</span></div>
                <span className="text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 mt-px" style={{ background: s.pill, color: s.text }}>{v.severity}</span>
              </div>
              <div className="text-xs text-[#7c2d12] mt-1.5">{v.detail}{v.travellerName ? ` · ${v.travellerName}` : ''}</div>
              <div className="text-xs mt-1.5 text-[#7c2d12]"><span className="font-semibold">Justification:</span> {v.justification ? <span className="italic">&ldquo;{v.justification}&rdquo;</span> : <span className="opacity-70">— none provided</span>}</div>
              {v.impactSgd > 0 && <div className="text-sm mt-2 pt-2 border-t flex items-center justify-between" style={{ borderColor: s.border }}><span className="text-[#7c2d12]">Impact (est.)</span><span className="font-bold tabular-nums text-[#5a1e0a]">{fmtSgd(v.impactSgd)}</span></div>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------ Cost Allocation (was Funding) */
export function CostAllocationCard({ req, amount, letter }: { req: FullRequest; amount: number; letter?: string }) {
  const research = req.allocations.some((a) => EcsCharging.code(a.chargingCode)?.isResearch);
  const crossCharge = req.allocations.length > 1;
  const primary = [...req.allocations].sort((a, b) => b.percent - a.percent)[0];
  const primaryDept = EcsIdentity.department(EcsCharging.code(primary?.chargingCode ?? '')?.departmentId ?? '')?.name;
  const others = req.allocations.filter((a) => a.id !== primary?.id);
  const m6Delta = ntuUpgradeDeltaTotal(req.expenses);   // #14 NTU-funded upgrade differential total
  const m6Rows = ntuUpgradeDeltaByAccount(req.expenses); // #14 per selected M6 account (usually one)
  const primaryMaster = EcsCharging.code(primary?.chargingCode ?? '');
  const m6Company = primaryMaster?.companyCode ?? primary?.companyCode ?? '1000';
  const m6BA = primaryMaster?.businessArea ?? primary?.businessArea ?? '—';
  // Collapsed-header stub — the main account at a glance, plus the cross-charge count when split.
  const stub = !primary ? '—'
    : crossCharge ? `${primary.chargingCode} ${primary.percent}% · +${others.length} account${others.length > 1 ? 's' : ''}`
    : `${primary.chargingCode} · 100%`;
  return (
    <CollapsibleCard title={heading(letter, 'Cost Allocation')} stub={stub}>
      <div className="grid md:grid-cols-4 gap-3 mb-3">
        <Field label="Cost allocation required?">{crossCharge ? <span className="pill-pass">Yes</span> : <span className="pill-info">No</span>}</Field>
        <Field label="Research funding">{research ? <span className="pill-warn">Research WBS</span> : 'No'}</Field>
        <Field label="Main charging account">{primary ? `${primary.chargingCode} · ${EcsCharging.code(primary.chargingCode)?.name ?? ''}` : '—'}<div className="text-xs text-[var(--ecs-muted)]">{primaryDept ?? ''}</div></Field>
        <Field label="Approval Basis">Highest-share charging line{crossCharge ? ' + cost allocation' : ''} (Gross Estimate).</Field>
      </div>
      {/* §17 Accounts list is height-capped (~4 rows) and scrolls when a request cross-charges across
          many accounts, so the card stays compact; the header and the total row stay pinned in view. */}
      <div className="overflow-auto max-h-[240px]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10"><tr>
            <th className="th">Company Code</th><th className="th">Business Area</th><th className="th">CC/WBS</th><th className="th">CC/WBS Charging Account</th>
            <th className="th">Internal Order</th><th className="th">Main acct</th><th className="th text-right">% of allocation</th><th className="th text-right">Amount (SGD)</th>
          </tr></thead>
          <tbody>
            {req.allocations.map((a) => {
              const c = EcsCharging.code(a.chargingCode);
              return (
                <tr key={a.id} className="hover:bg-[var(--ecs-panel-2)]">
                  <td className="td">{c?.companyCode ?? a.companyCode ?? '—'}</td>
                  <td className="td whitespace-nowrap">{c?.businessArea ?? a.businessArea ?? '—'}{c?.isResearch && <span className="pill-warn ml-1">Research</span>}</td>
                  <td className="td">{c?.type ?? a.chargingType}</td>
                  <td className="td whitespace-nowrap">{a.chargingCode} · {c?.name}{c?.fundingOwnerId && <div className="text-xs text-[var(--ecs-muted)]">Funding owner: {EcsIdentity.employee(c.fundingOwnerId)?.name}</div>}</td>
                  <td className="td">{a.internalOrder ?? '—'}</td>
                  <td className="td">{a.isMain ? 'Yes' : 'No'}</td>
                  <td className="td text-right">{a.percent}%</td>
                  <td className="td text-right whitespace-nowrap font-medium">{fmtSgd(((amount - m6Delta) * a.percent) / 100)}</td>
                </tr>
              );
            })}
            {m6Rows.map((m) => (
              <tr key={m.code ?? 'm6'} className="hover:bg-[var(--ecs-panel-2)]">
                <td className="td">{m6Company}</td>
                <td className="td whitespace-nowrap">{m6BA}</td>
                <td className="td">CC</td>
                <td className="td whitespace-nowrap">{m.code ?? '—'} · M6 Entitlement Differential <span className="pill-info ml-1">M6</span></td>
                <td className="td">—</td>
                <td className="td">No</td>
                <td className="td text-right">—</td>
                <td className="td text-right whitespace-nowrap font-medium">{fmtSgd(m.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="sticky bottom-0"><tr className="font-semibold text-[var(--ecs-navy)] bg-white"><td className="td" colSpan={6}>Total estimated NTU-funded cost</td><td className="td text-right">{req.allocations.reduce((s, a) => s + a.percent, 0)}%</td><td className="td text-right">{fmtSgd(amount)}</td></tr></tfoot>
        </table>
      </div>
      {crossCharge && (
        <p className="text-xs text-[var(--ecs-muted)] mt-2">
          Cross-charge: {others.map((a) => EcsIdentity.department(EcsCharging.code(a.chargingCode)?.departmentId ?? '')?.name).join(', ')} receive an informational notification; the approving DOA is derived from the highest-share department (§13.14).
        </p>
      )}
    </CollapsibleCard>
  );
}

/** Plain-language explanation of how the budgeted nightly rate was arrived at, instead of the raw
 *  basis code. The LOWER basis budgets at the lower of the quoted rate and the cap. */
function budgetBasisPhrase(a: { quotedNightly: number; capNightly: number }, basis: string | null): string {
  if (basis === 'QUOTED') return 'actual quoted rate';
  if (basis === 'CAP') return 'city cap';
  // LOWER (default): the lower of the quoted rate and the cap.
  if (a.capNightly > 0 && a.quotedNightly > a.capNightly) return 'capped at the city cap';
  if (a.capNightly > 0 && a.quotedNightly < a.capNightly) return 'actual quote, under cap';
  return 'quote at the cap';
}

/* --------------------------------------- Estimated Cost Items (+ merged summary) */
export function CostItems({ req, summary, basis, letter, lineActions, outcomeFor, bare }: {
  req: FullRequest; summary: CostSummary; basis: string; letter?: string;
  // Estimates step only: per-line Edit/Remove or rate-edit controls shown in a row's expanded
  // breakdown, and a LIVE policy outcome (the Review step omits both and uses the persisted checks).
  lineActions?: (e: FullRequest['expenses'][number]) => React.ReactNode;
  outcomeFor?: (category: string, lines: FullRequest['expenses']) => { exc: boolean; label: string };
  // Render just the table (no Card wrapper) so it can share a card with the inline add-line tabs
  // on the Estimates step (EstimateCostAdd supplies the card + "Estimated … Travel Cost Items" head).
  bare?: boolean;
}) {
  const legs = sharedLegs(req);
  const exView = exceptionViews(req);
  const clsName = (id?: string | null) => EcsReference.travelClass(id ?? '')?.name ?? '—';
  const empName = (id?: string | null) => EcsIdentity.employee(id ?? '')?.name ?? 'Traveller';
  const fmtD = (d?: Date | null) => (d ? d.toISOString().slice(0, 10) : '—');
  // §4.5/§13.19 per-line context shared across cost items: dates, personal extension and
  // the travel-class entitlement vs the selected class with justification.
  const personalText = req.personalStart && req.personalEnd ? `Yes · ${fmtD(req.personalStart)} → ${fmtD(req.personalEnd)}` : 'No';
  const classKvFor = (travellerId?: string | null, selectedId?: string | null): [string, string][] => {
    const t = travellerId ? req.travellers.find((x) => x.employeeId === travellerId) : undefined;
    // §13.19: employees not in the travel-class register default to Economy.
    const entitled = t?.entitledClassId ?? req.entitledClassId ?? 'TC-ECO';
    const selected = selectedId ?? t?.chosenClassId ?? req.travelClassId;
    const justification = t?.classJustification ?? req.classJustification;
    const kv: [string, string][] = [['Entitled class', clsName(entitled)], ['Selected class', clsName(selected)]];
    if (entitled && selected && entitled !== selected) kv.push(['Exception justification (class above entitlement)', justification?.trim() || '— (none provided)']);
    return kv;
  };
  const datesFor = (travellerId?: string | null): [string, string] => {
    const t = travellerId ? req.travellers.find((x) => x.employeeId === travellerId) : undefined;
    return ['Travel dates', `${fmtD(t?.ownStartDate ?? req.startDate)} → ${fmtD(t?.ownEndDate ?? req.endDate)}`];
  };

  const byType = new Map<string, { typeId: string; category: string; gross: number; sponsor: number; lines: FullRequest['expenses'] }>();
  for (const e of req.expenses) {
    const cur = byType.get(e.expenseTypeId) ?? { typeId: e.expenseTypeId, category: e.category, gross: 0, sponsor: 0, lines: [] };
    cur.gross += e.sgdAmount; cur.sponsor += e.sponsorSgd; cur.lines.push(e);
    byType.set(e.expenseTypeId, cur);
  }

  const rows: CostRow[] = [...byType.values()].map((r) => {
    let detail = r.lines[0].notes ?? '—';
    let basisLabel = 'Quotation';
    const breakdown: BreakLine[] = [];

    if (r.category === EXPENSE_CATEGORY.Airfare) {
      detail = legs.length ? `${legs[0].originCode} – ${legs.map((l) => l.destCode).join(' – ')}` : '—';
      basisLabel = clsName(req.travelClassId);
      for (const e of r.lines) breakdown.push({
        heading: req.isGroup ? empName(e.travellerId) : 'Airfare',
        total: e.sgdAmount,
        groups: [
          { title: 'Flight', fields: [
            ['Route', `${e.originCode ?? legs[0]?.originCode ?? ''} → ${e.destCode ?? ''}`],
            datesFor(e.travellerId),
            ['Personal extension', personalText],
          ] },
          { title: 'Class & fare', fields: [
            ...classKvFor(e.travellerId, e.proposedClassId),
            ['Fare ceiling', fmtSgd(e.fareCeiling ?? e.sgdAmount)],
          ] },
        ],
        computation: `Quoted fare ${fmtSgd(e.sgdAmount)}${e.sponsorSgd ? ` less sponsorship ${fmtSgd(e.sponsorSgd)}` : ''}.`,
        actions: lineActions?.(e),
      });
    } else if (r.category === EXPENSE_CATEGORY.Accommodation) {
      // Multi-city: one hotel line is derived per stop × traveller, all sharing ET-ACC and so grouped
      // into this single row. Summarise the DISTINCT stops (deduped across travellers) in the Details
      // column — not just the first — so a multi-city trip reads every city it was budgeted for. Stops
      // are keyed by leg when present, else by city (older/demo lines carry no legSeq), so distinct
      // cities never collapse and traveller duplicates do.
      const accStops = new Map<string, { city: string; nights: number }>();
      for (const e of [...r.lines].filter((x) => x.accommodation).sort((x, y) => (x.accommodation!.legSeq ?? 9999) - (y.accommodation!.legSeq ?? 9999))) {
        const a = e.accommodation!; const k = a.legSeq != null ? `L${a.legSeq}` : `C${a.city}`;
        if (!accStops.has(k)) accStops.set(k, { city: EcsReference.city(a.city)?.name ?? a.city, nights: a.nights });
      }
      const accParts = [...accStops.values()].map((s) => `${s.city}, ${s.nights} night${s.nights === 1 ? '' : 's'}`);
      detail = accParts.length ? (accParts.length > 3 ? `${accParts.slice(0, 3).join(' · ')} +${accParts.length - 3} more` : accParts.join(' · ')) : '—';
      const anyOverCap = r.lines.some((e) => e.accommodation?.exceptionOutcome === POLICY_OUTCOME.Exception);
      basisLabel = `Hotel cap · ${anyOverCap ? 'over cap' : 'within cap'}`;
      for (const e of r.lines) {
        const a = e.accommodation; if (!a) continue;
        const city = EcsReference.city(a.city)?.name ?? a.city;
        if (e.isShared) {
          req.travellers.forEach((t, ti) => {
            const nights = travellerNightsAtCity(req, t.employeeId, a.city);
            breakdown.push({
              heading: `${empName(t.employeeId)} · ${city}`,
              total: nights * a.budgetedNightly,
              groups: [
                { title: 'Stay', fields: [datesFor(t.employeeId), ['Nights', `${nights}`], ['Personal extension', personalText]] },
                { title: 'Rate', fields: [['Rate / night', fmtSgd(a.budgetedNightly)], ['Cap / night', fmtSgd(a.capNightly)]] },
              ],
              computation: `${nights} nights × ${fmtSgd(a.budgetedNightly)} = ${fmtSgd(nights * a.budgetedNightly)}.`,
              actions: ti === 0 ? lineActions?.(e) : undefined,
            });
          });
        } else {
          const chargeable = Math.max(a.nights - a.personalNights, 0);
          const stayFields: BreakField[] = [
            ['Stay dates', `${fmtD(a.checkIn)} → ${fmtD(a.checkOut)}`],
            ['Nights', `${a.nights}${a.personalNights ? ` (−${a.personalNights} personal)` : ''}`],
          ];
          if (a.personalNights > 0) stayFields.push(['Chargeable nights', `${chargeable}`]);
          stayFields.push(['Personal extension', a.personalNights ? `Yes · ${a.personalNights} personal night${a.personalNights > 1 ? 's' : ''}` : personalText]);
          const rateFields: BreakField[] = [
            ['Budgeted / night', fmtSgd(a.budgetedNightly), budgetBasisPhrase(a, e.estimateBasis)],
            ['Quoted / cap', `${fmtSgd(a.quotedNightly)} / ${fmtSgd(a.capNightly)}`],
          ];
          if (a.capVariance > 0) rateFields.push(['Cap variance', fmtSgd(a.capVariance)]);
          breakdown.push({
            heading: req.isGroup ? `${empName(e.travellerId)} · ${city}` : city,
            total: e.sgdAmount,
            groups: [{ title: 'Stay', fields: stayFields }, { title: 'Rate', fields: rateFields }],
            computation: `${chargeable} nights × ${fmtSgd(a.budgetedNightly)} (${budgetBasisPhrase(a, e.estimateBasis)}) = ${fmtSgd(e.sgdAmount)}.${a.capVariance ? ` Quoted ${fmtSgd(a.quotedNightly)}/night exceeds cap ${fmtSgd(a.capNightly)}/night → variance ${fmtSgd(a.capVariance)} (exception).` : ''}`,
            actions: lineActions?.(e),
          });
        }
      }
    } else if (r.category === EXPENSE_CATEGORY.ODA) {
      // Multi-city: one ODA line per stop × employee, all sharing ET-ODA. ODA is a COUNTRY
      // entitlement, so summarise distinct stops (deduped across travellers by leg, else by country)
      // and then MERGE by country — summing the days — so two cities in one country read as a single
      // "Japan, 4 days" rather than "Japan · Japan". The Gross/NTU totals already sum all stops.
      const odaStops = new Map<string, { country: string; days: number }>();
      for (const e of [...r.lines].filter((x) => x.oda).sort((x, y) => (x.oda!.legSeq ?? 9999) - (y.oda!.legSeq ?? 9999))) {
        const o = e.oda!; const k = o.legSeq != null ? `L${o.legSeq}` : `C${o.country}`;
        if (!odaStops.has(k)) odaStops.set(k, { country: o.country, days: o.eligibleDays });
      }
      const odaByCountry = new Map<string, number>();
      for (const s of odaStops.values()) odaByCountry.set(s.country, (odaByCountry.get(s.country) ?? 0) + s.days);
      const odaParts = [...odaByCountry.entries()].map(([c, d]) => `${EcsReference.country(c)?.name ?? c}, ${d} day${d === 1 ? '' : 's'}`);
      detail = odaParts.length ? (odaParts.length > 3 ? `${odaParts.slice(0, 3).join(' · ')} +${odaParts.length - 3} more` : odaParts.join(' · ')) : '—';
      basisLabel = 'ODA rate';
      for (const e of r.lines) {
        const o = e.oda; if (!o) continue;
        const odaWhere = EcsReference.city(o.city ?? '')?.name ?? EcsReference.country(o.country)?.name ?? o.country;
        const monthly = EcsPolicy.odaMonthlyRate(o.country) ?? 0;
        const tc = computeOdaTiered({ days: o.eligibleDays, dailyRate: o.dailyRate, monthlyRate: monthly });
        const tiered = tc.t2 > 0 || tc.t3 > 0; // step-downs only apply beyond 15 days
        const tripFields: BreakField[] = [
          ['Country', EcsReference.country(o.country)?.name ?? o.country],
          ['Dates', `${fmtD(o.arrive)} → ${fmtD(o.depart)}`],
          ['Eligible days', `${o.eligibleDays}`],
        ];
        if (o.personalDays > 0) tripFields.push(['Personal extension', `Yes · ${o.personalDays} personal day${o.personalDays > 1 ? 's' : ''}`]);
        const rateFields: BreakField[] = [['Daily rate', `${fmtSgd(o.dailyRate)}/day`]];
        if (tc.t3 > 0) rateFields.push(['Monthly rate', `${fmtSgd(monthly)}`, 'days 32+ at monthly ÷ 30']);
        // Tiered computation text for a longer trip; a short trip keeps the plain line.
        let computation: string;
        if (!tiered) {
          computation = `${tc.t1} days × ${fmtSgd(o.dailyRate)}/day = ${fmtSgd(e.sgdAmount)}.`;
        } else {
          const parts: string[] = [`${tc.t1} × ${fmtSgd(o.dailyRate)} (100%) = ${fmtSgd(tc.t1Amt)}`];
          if (tc.t2 > 0) parts.push(`${tc.t2} × ${fmtSgd(o.dailyRate)} × 75% = ${fmtSgd(tc.t2Amt)}`);
          if (tc.t3 > 0) parts.push(`${tc.t3} × ${fmtSgd(monthly)} ÷ 30 = ${fmtSgd(tc.t3Amt)}`);
          computation = `Tiered: ${parts.join('  +  ')}  =  ${fmtSgd(e.sgdAmount)}.`;
        }
        breakdown.push({
          heading: req.isGroup ? `${empName(e.travellerId)} · ${odaWhere}` : `${EcsReference.country(o.country)?.name} ODA`,
          total: e.sgdAmount,
          groups: [
            { title: 'Trip', fields: tripFields },
            { title: 'Rate', fields: rateFields },
          ],
          computation,
          actions: lineActions?.(e),
        });
      }
    } else {
      for (const e of r.lines) breakdown.push({
        heading: EcsReference.expenseType(e.expenseTypeId)?.name ?? 'Item',
        total: e.sgdAmount,
        groups: [{ title: 'Detail', fields: e.notes ? [['Amount', fmtSgd(e.sgdAmount)], ['Note', e.notes]] : [['Amount', fmtSgd(e.sgdAmount)]] }],
        computation: e.notes ?? 'Quoted estimate.',
        actions: lineActions?.(e),
      });
    }

    const catExc = exView.filter((v) => (v.code === 'CLASS' && r.category === EXPENSE_CATEGORY.Airfare) || (v.code === 'HOTEL_CAP' && r.category === EXPENSE_CATEGORY.Accommodation));
    // Estimates step passes a live outcome (evaluated from the current lines); the Review step uses
    // the persisted policy checks (exView).
    const live = outcomeFor?.(r.category, r.lines);
    return {
      typeName: EcsReference.expenseType(r.typeId)?.name ?? r.typeId,
      detail, basis: basisLabel, gross: r.gross, sponsor: r.sponsor, ntu: r.gross - r.sponsor,
      outcomeExc: live ? live.exc : catExc.length > 0,
      outcomeLabel: live ? live.label : catExc.length === 0 ? 'Within Policy' : req.isGroup ? `${catExc.length} Traveller${catExc.length > 1 ? 's' : ''} with Exception` : 'Exception',
      breakdown,
    };
  });

  // Summary lines continue the Gross Estimate column below the table Total — the gross
  // total itself is not repeated (it is the table's Gross Estimate Total).
  const summaryRows: SummaryRow[] = [
    { label: 'Less expected sponsorship / personal', value: summary.sponsorship, paren: summary.sponsorship > 0 },
    { label: 'Estimated NTU-funded amount', value: summary.ntuFunded, strong: true },
    { label: `Approval amount (${basis})`, value: summary.approvalAmount, strong: true, divider: true },
    { label: 'Approved booking ceiling', value: summary.bookingCeiling },
  ];

  const body = (
    <>
      <p className="text-xs text-[var(--ecs-muted)] mb-2">Click a row to see how the amount is computed (cap, nights, rate, eligible days).</p>
      <CostItemsTable rows={rows} group={req.isGroup} summaryRows={summaryRows} />
    </>
  );
  if (bare) return body;
  return <Card title={heading(letter, `Estimated ${req.isGroup ? 'Group ' : ''}Travel Cost Items`)}>{body}</Card>;
}

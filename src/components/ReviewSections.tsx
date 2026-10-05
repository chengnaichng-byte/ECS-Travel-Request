// Review-page sections for the OpenAI approver design. Variant-aware across
// individual / multi-leg / group travel requests. Section letters are assigned by the
// page (dynamic, no gaps). Read-oriented; interactive group editing lives in
// GroupTravellers (collapsible workbench on the detail page).
import { EcsIdentity, EcsReference, EcsCharging } from '@/shared/ecs/services';
import { fmtSgd, type CostSummary } from '@/modules/pretrip/pricing';
import { sharedLegs, computeTravellerShares, hasPersonalExtension, travellerNightsAtCity } from '@/modules/pretrip/group';
import { isGuestRequest, travellerName, travellerTitle, travellerEmail } from '@/modules/pretrip/traveller';
import { exceptionViews, daysToBook } from '@/modules/pretrip/exceptions';
import { EXPENSE_CATEGORY, POLICY_OUTCOME, BOOKING_METHOD_LABEL } from '@/shared/enums';
import { Card } from './ui';
import { CostItemsTable, type CostRow, type BreakLine, type SummaryRow } from './CostItemsTable';
import type { FullRequest } from '@/modules/pretrip/queries';

const fmtDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '—');
const heading = (letter: string | undefined, name: string) => (letter ? `${letter}. ${name}` : name);
function durationDN(a: Date | null, b: Date | null) {
  if (!a || !b) return '';
  const days = Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
  return `${days}D/${Math.max(days - 1, 0)}N`;
}
function primaryCharging(req: FullRequest) {
  const p = [...req.allocations].sort((a, b) => b.percent - a.percent)[0];
  if (!p) return null;
  const c = EcsCharging.code(p.chargingCode);
  return { code: p.chargingCode, name: c?.name ?? '', dept: EcsIdentity.department(c?.departmentId ?? '')?.name ?? '', pct: p.percent, research: c?.isResearch };
}

function Field({ label, children, accent }: { label: string; children: React.ReactNode; accent?: boolean }) {
  return (
    <div>
      <div className={`text-xs ${accent ? 'text-[var(--ecs-navy)] font-semibold' : 'text-[var(--ecs-muted)]'} mb-0.5`}>{label}</div>
      <div className="text-sm">{children ?? '—'}</div>
    </div>
  );
}

/* -------------------------------------------------------- top summary banner */
export function SummaryCard({ req, bookingDeadlineDays }: { req: FullRequest; bookingDeadlineDays: number }) {
  const legs = sharedLegs(req);
  const isMulti = legs.length > 2;
  const purpose = EcsReference.travelPurpose(req.purposeId ?? '')?.name ?? '—';
  const cls = EcsReference.travelClass(req.travelClassId ?? '')?.name ?? '—';
  const dests = isMulti
    ? [legs[0]?.originCode, ...legs.map((l) => l.destCode)].map((c) => EcsReference.airport(c ?? '')?.cityCode ?? c).filter(Boolean)
    : [EcsReference.city(req.destCity ?? '')?.name];
  const countries = new Set(legs.map((l) => EcsReference.city(EcsReference.airport(l.destCode)?.cityCode ?? '')?.countryCode).filter((c) => c && c !== 'SG'));
  const { days } = daysToBook(req, bookingDeadlineDays);
  const validityEnd = req.authorisationExpiry ?? (req.startDate ? new Date(req.startDate.getTime() - bookingDeadlineDays * 86400000) : null);
  const pc = primaryCharging(req);

  return (
    <Card>
      <div className="grid md:grid-cols-3 xl:grid-cols-5 gap-4">
        <Field label="Travel Purpose" accent>{purpose}</Field>
        <Field label={isMulti ? 'Destinations' : 'Destination'} accent>
          {isMulti ? (
            <div>
              <div>{dests.join(' → ')}</div>
              <span className="pill-navy mt-1">{legs.length} legs · {countries.size} countries</span>
            </div>
          ) : (
            `${EcsReference.city(req.destCity ?? '')?.name ?? '—'}, ${EcsReference.country(req.destCountry ?? '')?.name ?? ''}`
          )}
        </Field>
        <Field label="Official Travel Dates" accent>{fmtDate(req.startDate)} – {fmtDate(req.endDate)} {durationDN(req.startDate, req.endDate) && <span className="text-[var(--ecs-muted)]">({durationDN(req.startDate, req.endDate)})</span>}</Field>
        <Field label={`Proposed Travel Class${req.isGroup ? ' (Group)' : ''}`} accent>{cls}</Field>
        <Field label="Travel Authorisation Validity" accent>
          {fmtDate(req.createdAt)} – {fmtDate(validityEnd)}
          <div className="mt-1"><span className="pill-pass">{days} days to book</span></div>
        </Field>

        <Field label="Event / Conference">{req.description?.split('—')[0] ?? '—'}</Field>
        <Field label="Booking Method">{req.bookingMethod ? BOOKING_METHOD_LABEL[req.bookingMethod] ?? req.bookingMethod : '—'}</Field>
        <Field label="Primary Charging Account">
          {pc ? <span>{pc.code} · {pc.name} <span className="text-[var(--ecs-muted)]">({pc.pct}%{pc.research ? ' · research' : ''})</span></span> : '—'}
        </Field>
        <Field label="Personal Extension">
          {req.isGroup ? `${req.travellers.filter((t) => hasPersonalExtension(req, t.employeeId)).length} travellers` : (req.personalStart ? `${fmtDate(req.personalStart)} – ${fmtDate(req.personalEnd)}` : 'None')}
        </Field>
        {req.isGroup && <Field label="Group Coordinator">{EcsIdentity.employee(req.requestorId)?.name}</Field>}
        <Field label="Trip Description / Business Justification">{req.description ?? '—'}</Field>
      </div>
    </Card>
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
            <th className="th">#</th><th className="th">Traveller</th><th className="th">Department</th>
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
                  <td className="td font-medium">{EcsIdentity.employee(t.employeeId)?.name}{t.isRequestor && <span className="pill-navy ml-1">Coord.</span>}</td>
                  <td className="td text-xs">{EcsIdentity.department(EcsIdentity.employee(t.employeeId)?.departmentId ?? '')?.name}</td>
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
              <td className="td" colSpan={4}>Total ({req.travellers.length} travellers)</td>
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
  const sevClass: Record<string, string> = { Low: 'pill-info', Medium: 'pill-warn', High: 'pill-stop' };
  if (views.length === 0) return (
    <Card title={heading(letter, 'Policy Exceptions')} className={className}><div className="flex items-center gap-2 text-sm"><span className="pill-pass">Pass</span> No policy exceptions.</div></Card>
  );
  return (
    <Card title={heading(letter, `Policy Exceptions (${views.length})`)} className={className}>
      <div className="grid md:grid-cols-2 gap-3">
        {views.map((v, i) => (
          <div key={i} className="border border-[#f0d9a8] bg-[#fff8ec] rounded p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium text-sm flex items-center gap-2"><span className="text-[#c07a00]">⚠</span> {v.label}</div>
              <span className={sevClass[v.severity]}>{v.severity}</span>
            </div>
            <div className="text-xs text-[var(--ecs-muted)] mt-1">{v.detail}{v.travellerName ? ` · ${v.travellerName}` : ''}</div>
            {v.impactSgd > 0 && <div className="text-sm mt-1">Impact (est.) <span className="font-semibold">{fmtSgd(v.impactSgd)}</span></div>}
          </div>
        ))}
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
  return (
    <Card title={heading(letter, 'Cost Allocation')}>
      <div className="grid md:grid-cols-4 gap-3 mb-3">
        <Field label="Cross-charge">{crossCharge ? <span className="pill-pass">Yes</span> : <span className="pill-info">No</span>}</Field>
        <Field label="Research funding">{research ? <span className="pill-warn">Research WBS</span> : 'No'}</Field>
        <Field label="Primary Charging Unit">{primaryDept ?? '—'}</Field>
        <Field label="Approval Basis">Highest-share charging line{crossCharge ? ' + cross-charge allocation' : ''} (Gross Estimate).</Field>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr><th className="th">Charging Unit</th><th className="th">CC / WBS</th><th className="th">Charging Account</th><th className="th">Company / BA</th><th className="th text-right">%</th><th className="th text-right">Amount (SGD)</th></tr></thead>
          <tbody>
            {req.allocations.map((a) => {
              const c = EcsCharging.code(a.chargingCode);
              return (
                <tr key={a.id} className="hover:bg-[var(--ecs-panel-2)]">
                  <td className="td">{EcsIdentity.department(c?.departmentId ?? '')?.name ?? c?.name}{c?.isResearch && <span className="pill-warn ml-1">Research</span>}</td>
                  <td className="td">{a.chargingCode}</td>
                  <td className="td">{c?.name}{c?.fundingOwnerId && <div className="text-xs text-[var(--ecs-muted)]">Funding owner: {EcsIdentity.employee(c.fundingOwnerId)?.name}</div>}</td>
                  <td className="td whitespace-nowrap">{c?.companyCode ?? a.companyCode} · {c?.businessArea ?? a.businessArea}</td>
                  <td className="td text-right">{a.percent}%</td>
                  <td className="td text-right whitespace-nowrap font-medium">{fmtSgd((amount * a.percent) / 100)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr className="font-semibold text-[var(--ecs-navy)]"><td className="td" colSpan={4}>Total estimated NTU-funded cost</td><td className="td text-right">{req.allocations.reduce((s, a) => s + a.percent, 0)}%</td><td className="td text-right">{fmtSgd(amount)}</td></tr></tfoot>
        </table>
      </div>
      {crossCharge && (
        <p className="text-xs text-[var(--ecs-muted)] mt-2">
          Cross-charge: {others.map((a) => EcsIdentity.department(EcsCharging.code(a.chargingCode)?.departmentId ?? '')?.name).join(', ')} receive an informational notification; the approving DOA is derived from the highest-share department (§13.14).
        </p>
      )}
    </Card>
  );
}

/* --------------------------------------- Estimated Cost Items (+ merged summary) */
export function CostItems({ req, summary, basis, letter }: { req: FullRequest; summary: CostSummary; basis: string; letter?: string }) {
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
    if (entitled && selected && entitled !== selected) kv.push(['Upgrade justification', justification?.trim() || '— (none provided)']);
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
        kv: [
          ['Route', `${e.originCode ?? legs[0]?.originCode ?? ''} → ${e.destCode ?? ''}`],
          datesFor(e.travellerId),
          ['Personal extension', personalText],
          ...classKvFor(e.travellerId, e.proposedClassId),
          ['Fare ceiling', fmtSgd(e.fareCeiling ?? e.sgdAmount)],
        ],
        computation: `Quoted fare ${fmtSgd(e.sgdAmount)}${e.sponsorSgd ? ` less sponsorship ${fmtSgd(e.sponsorSgd)}` : ''}.`,
      });
    } else if (r.category === EXPENSE_CATEGORY.Accommodation) {
      const a0 = r.lines[0].accommodation;
      detail = a0 ? `${EcsReference.city(a0.city)?.name ?? a0.city}, ${a0.nights} nights` : '—';
      basisLabel = `Hotel cap · ${a0?.exceptionOutcome === POLICY_OUTCOME.Exception ? 'over cap' : 'within cap'}`;
      for (const e of r.lines) {
        const a = e.accommodation; if (!a) continue;
        const city = EcsReference.city(a.city)?.name ?? a.city;
        if (e.isShared) {
          for (const t of req.travellers) {
            const nights = travellerNightsAtCity(req, t.employeeId, a.city);
            breakdown.push({ heading: `${empName(t.employeeId)} · ${city}`, kv: [datesFor(t.employeeId), ['Personal extension', personalText], ['Nights', `${nights}`], ['Rate / night', fmtSgd(a.budgetedNightly)], ['Cap / night', fmtSgd(a.capNightly)]], computation: `${nights} nights × ${fmtSgd(a.budgetedNightly)} = ${fmtSgd(nights * a.budgetedNightly)}.` });
          }
        } else {
          const chargeable = Math.max(a.nights - a.personalNights, 0);
          breakdown.push({ heading: city, kv: [['Stay dates', `${fmtD(a.checkIn)} → ${fmtD(a.checkOut)}`], ['Personal extension', a.personalNights ? `Yes · ${a.personalNights} personal night${a.personalNights > 1 ? 's' : ''}` : personalText], ['Quoted / night', fmtSgd(a.quotedNightly)], ['Cap / night', fmtSgd(a.capNightly)], ['Budgeted / night', `${fmtSgd(a.budgetedNightly)} (${e.estimateBasis})`], ['Nights', `${a.nights}${a.personalNights ? ` (−${a.personalNights} personal)` : ''}`], ['Chargeable nights', `${chargeable}`], ['Cap variance', a.capVariance ? fmtSgd(a.capVariance) : '—']], computation: `${chargeable} nights × ${fmtSgd(a.budgetedNightly)} (${e.estimateBasis}) = ${fmtSgd(e.sgdAmount)}.${a.capVariance ? ` Quoted ${fmtSgd(a.quotedNightly)}/night exceeds cap ${fmtSgd(a.capNightly)}/night → variance ${fmtSgd(a.capVariance)} (exception).` : ''}` });
        }
      }
    } else if (r.category === EXPENSE_CATEGORY.ODA) {
      const o0 = r.lines[0].oda;
      detail = o0 ? `${EcsReference.country(o0.country)?.name}, ${o0.eligibleDays} days` : '—';
      basisLabel = 'ODA rate';
      for (const e of r.lines) {
        const o = e.oda; if (!o) continue;
        breakdown.push({ heading: req.isGroup ? empName(e.travellerId) : `${EcsReference.country(o.country)?.name} ODA`, kv: [['Country', EcsReference.country(o.country)?.name ?? o.country], ['Official dates', `${fmtD(o.arrive)} → ${fmtD(o.depart)}`], ['Personal extension', o.personalDays ? `Yes · ${o.personalDays} personal day${o.personalDays > 1 ? 's' : ''}` : personalText], ['Eligible days', `${o.eligibleDays}`], ['Daily rate', fmtSgd(o.dailyRate)]], computation: `${o.eligibleDays} eligible days at ${fmtSgd(o.dailyRate)}/day (departure & return days at 50%) = ${fmtSgd(e.sgdAmount)}.` });
      }
    } else {
      for (const e of r.lines) breakdown.push({ heading: EcsReference.expenseType(e.expenseTypeId)?.name ?? 'Item', kv: [['Amount', fmtSgd(e.sgdAmount)]], computation: e.notes ?? 'Quoted estimate.' });
    }

    const catExc = exView.filter((v) => (v.code === 'CLASS' && r.category === EXPENSE_CATEGORY.Airfare) || (v.code === 'HOTEL_CAP' && r.category === EXPENSE_CATEGORY.Accommodation));
    return {
      typeName: EcsReference.expenseType(r.typeId)?.name ?? r.typeId,
      detail, basis: basisLabel, gross: r.gross, sponsor: r.sponsor, ntu: r.gross - r.sponsor,
      outcomeExc: catExc.length > 0,
      outcomeLabel: catExc.length === 0 ? 'Within Policy' : req.isGroup ? `${catExc.length} Traveller${catExc.length > 1 ? 's' : ''} with Exception` : 'Exception',
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

  return (
    <Card title={heading(letter, `Estimated ${req.isGroup ? 'Group ' : ''}Travel Cost Items`)}>
      <p className="text-xs text-[var(--ecs-muted)] mb-2">Click a row to see how the amount is computed (cap, nights, rate, eligible days).</p>
      <CostItemsTable rows={rows} group={req.isGroup} summaryRows={summaryRows} />
    </Card>
  );
}

// TR-05..08 Estimated Travel Costs — airfare, accommodation (with cap), ODA and
// permitted incidental costs. Reuses the TE expense pattern; receipt fields replaced
// by expected date, estimate basis and quotation (§4.4/§4.5).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadRequest } from '@/modules/pretrip/queries';
import { getSettings } from '@/modules/pretrip/settings';
import { currentPersonaId } from '@/shared/session';
import { canEditRequest } from '@/modules/pretrip/guards';
import { addAirfare, addAccommodation, addOther, deleteExpense, updateAccommodationRate, setHotelSettlement, updateClassJustification } from '@/modules/pretrip/actions';
import { EcsReference, EcsIdentity } from '@/shared/ecs/services';
import { memberName, isGuestRequest, isNonEmployeeMember, isStudentMember } from '@/modules/pretrip/traveller';
type TagRef = { travellerType?: string | null; employeeId: string };
/** " · student" / " · guest" / "" — the non-employee label suffix for a member, with a chosen separator. */
const memberTag = (t: TagRef, sep: string) => isStudentMember(t) ? `${sep}student` : (isNonEmployeeMember(t) ? `${sep}guest` : '');
import { isTmcArrangement } from '@/modules/pretrip/booking';
import { provostsForSchool } from '@/modules/pretrip/provost';
import { AccommodationCityRate } from '@/components/AccommodationCityRate';
import { AddEstimatePanel } from '@/components/AddEstimatePanel';
import { computeSummary, fmtSgd } from '@/modules/pretrip/pricing';
import { cities, airports } from '@/data/locations';
import { travelClasses } from '@/data/travelClass';
import { hotelCaps, odaRates } from '@/data/policyRates';
import { currencies } from '@/data/fxRates';
import { expenseTypes } from '@/data/expenseTypes';
import { EXPENSE_CATEGORY, POLICY_OUTCOME } from '@/shared/enums';
import { Card, Stepper, Empty } from '@/components/ui';
import { DuplicateWarning } from '@/components/DuplicateWarning';
import { OutcomePill } from '@/components/StatusPill';

export const dynamic = 'force-dynamic';

export default async function EstimatesStep({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const { error } = await searchParams;
  const req = await loadRequest(id);
  if (!req) notFound();
  const settings = await getSettings();
  const canEdit = canEditRequest(await currentPersonaId(), req);
  const summary = computeSummary(req.expenses, settings.approvalAmountBasis);
  const allowIncidental = settings.expenseScope === 'ALL';
  // Pre-fill the add-forms from the trip the request already captured, so the traveller
  // doesn't re-key the destination and dates (§4.4/§4.5).
  const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : '');
  const sharedLegs = req.legs.filter((l) => !l.travellerId).sort((a, b) => a.seq - b.seq);
  const firstLeg = sharedLegs[0];
  const destAirport = airports.find((a) => a.cityCode === req.destCity)?.code ?? '';
  const tripDefaults = {
    origin: firstLeg?.originCode ?? 'SIN',
    destAirport: firstLeg?.destCode ?? destAirport,
    classId: req.travelClassId ?? '',
    destCity: req.destCity ?? '',
    destCountry: req.destCountry ?? '',
    start: d(req.startDate),
    end: d(req.endDate),
    nights: req.startDate && req.endDate ? String(Math.max(Math.round((req.endDate.getTime() - req.startDate.getTime()) / 86400000), 0)) : '',
  };
  const isGroup = req.isGroup;
  // §13.19 entitled class for this itinerary (individual) — the baseline above which the traveller
  // must justify an upgrade on the airfare line.
  const entitledClassName = travelClasses.find((c) => c.id === (req.entitledClassId ?? req.travelClassId))?.name ?? 'Economy';
  // §13.19 an individual airfare above the derived entitlement needs a justification — detected here so
  // the standalone field below lets it be resolved on this step (not deferred to a policy-review hard stop).
  const classRank = (cid?: string | null) => travelClasses.find((c) => c.id === cid)?.rank ?? 1;
  const hasAirfare = req.expenses.some((e) => e.category === EXPENSE_CATEGORY.Airfare);
  const isClassUpgrade = !isGroup && !!req.travelClassId && !!req.entitledClassId && classRank(req.travelClassId) > classRank(req.entitledClassId) && hasAirfare;
  const chosenClassName = travelClasses.find((c) => c.id === req.travelClassId)?.name ?? req.travelClassId ?? '';
  // §13.14 group traveller options for individual lines, with an "All travellers" fan-out
  // (creates one line per traveller in a single submit) to speed up group request creation.
  const gTravellers: [string, string][] = [
    ['__ALL__', `All travellers (${req.travellers.length}) — one line each`],
    ...req.travellers.map((t) => [t.employeeId, memberName(t) + (isNonEmployeeMember(t) ? ` (${memberTag(t, '').trim()})` : '')] as [string, string]),
  ];
  // §8 ODA is not a guest entitlement — a pure guest request hides the ODA card, and a group's
  // ODA traveller picker offers employee members only (guests are also filtered server-side).
  const guestRequest = isGuestRequest(req);
  // §8 / DD-25 host-school Provost list for a guest travel-class upgrade (above Economy).
  const hostSchoolId = req.departmentId ?? EcsIdentity.employee(req.requestorId)?.departmentId ?? null;
  const provostOptions = guestRequest ? await provostsForSchool(hostSchoolId) : [];
  const economyId = travelClasses.find((c) => /eco/i.test(c.name))?.id ?? 'TC-ECO';
  const guestUpgrading = guestRequest && !!req.travelClassId && req.travelClassId !== economyId;
  // §4.5 hotel cap per city — the accommodation rate defaults to this (editable).
  const capByCity: Record<string, number> = Object.fromEntries(hotelCaps.map((h) => [h.cityCode, h.capNightlySgd]));
  const memberLabel = (key: string | null) => {
    const t = req.travellers.find((x) => x.employeeId === key);
    return t ? memberName(t) + memberTag(t, ' · ') : (EcsIdentity.employee(key ?? '')?.name ?? '—');
  };
  const attribution = (e: { isShared: boolean; travellerId: string | null }) =>
    e.isShared ? 'Shared (apportioned)' : memberLabel(e.travellerId);
  // §13.14 a genuinely shared line (e.g. a shared taxi) is shown apportioned across the group —
  // one row per traveller at their share (shareMap, else an equal split). Accommodation is no
  // longer shared (each traveller books their own room), so this applies only to shared incidentals.
  // §8 shared incidentals split across employee members only — guests carry no share.
  const guestIds = new Set(req.travellers.filter(isNonEmployeeMember).map((t) => t.employeeId));
  const sharers = req.travellers.filter((t) => !guestIds.has(t.employeeId));
  const apportion = (e: { sgdAmount: number; shareMap: string | null }) => {
    let sm: Record<string, number> = {};
    try { sm = e.shareMap ? JSON.parse(e.shareMap) : {}; } catch { sm = {}; }
    const entries = Object.entries(sm).filter(([eid]) => !guestIds.has(eid));
    const list = entries.length
      ? entries.map(([eid, pct]) => ({ eid, amount: e.sgdAmount * Number(pct) / 100 }))
      : sharers.map((t) => ({ eid: t.employeeId, amount: e.sgdAmount / (sharers.length || 1) }));
    return list.map((x) => ({ name: memberLabel(x.eid), amount: x.amount }));
  };
  // §13.14 group estimates grouped by cost item (expense type) with a per-traveller breakdown
  // and a rolled-up subtotal, so allocation can be reasoned about per expense.
  const grouped = (() => {
    const order: string[] = [];
    const by = new Map<string, { key: string; name: string; gross: number; lines: typeof req.expenses }>();
    for (const e of req.expenses) {
      const k = e.expenseTypeId;
      if (!by.has(k)) { by.set(k, { key: k, name: EcsReference.expenseType(k)?.name ?? e.category, gross: 0, lines: [] }); order.push(k); }
      const g = by.get(k)!; g.gross += e.sgdAmount; g.lines.push(e);
    }
    return order.map((k) => by.get(k)!);
  })();

  // Table-cell helpers — City/Country, From, To, Nights for a line (hotel / ODA / airfare / other).
  const fmtD2 = (x: Date | null | undefined) => (x ? x.toISOString().slice(0, 10) : '—');
  const cityCountryText = (e: (typeof req.expenses)[number]) => {
    if (e.accommodation) { const c = EcsReference.city(e.accommodation.city); return c ? [c.name, EcsReference.country(c.countryCode)?.name].filter(Boolean).join(', ') : e.accommodation.city; }
    if (e.oda) { const c = e.oda.city ? EcsReference.city(e.oda.city) : null; return [c?.name, EcsReference.country(e.oda.country)?.name ?? e.oda.country].filter(Boolean).join(', '); }
    if (e.category === EXPENSE_CATEGORY.Airfare) return `${e.originCode ?? ''} → ${e.destCode ?? ''}`;
    return '—';
  };
  const fromOf = (e: (typeof req.expenses)[number]) => e.accommodation?.checkIn ?? e.oda?.arrive ?? e.expectedDate ?? null;
  const toOf = (e: (typeof req.expenses)[number]) => e.accommodation?.checkOut ?? e.oda?.depart ?? null;
  const nightsOf = (e: (typeof req.expenses)[number]) => (e.accommodation ? e.accommodation.nights : e.oda ? e.oda.eligibleDays : null);

  return (
    <div>
      <Stepper id={id} active="estimates" requestNumber={req.requestNumber} status={req.status} />
      {error && <div className="card p-3 mb-4 text-sm text-red-800 bg-red-50 border-red-200">{error}</div>}
      <DuplicateWarning req={req} />
      {!canEdit && <div className="card p-3 mb-4 text-sm text-amber-900 bg-amber-50 border-amber-200">Read-only view — your role cannot edit this request's estimates.</div>}

      {/* §13.19 class-upgrade justification — resolved here, not at the policy-review hard stop */}
      {isClassUpgrade && canEdit && (
        <Card title="Class upgrade — justification required" className="mb-5">
          <form action={updateClassJustification.bind(null, id)} className="space-y-2">
            <p className="text-sm text-[var(--ecs-muted)]">You selected <strong>{chosenClassName}</strong>, above your entitlement of <strong>{entitledClassName}</strong> for this itinerary. A justification is required before the request can be submitted — enter it here (no need to remove and re-add the airfare).</p>
            <textarea name="classJustification" defaultValue={req.classJustification ?? ''} rows={2} required className="field" placeholder="e.g. overnight red-eye ahead of a same-day event; medical reason…" />
            <div className="flex items-center gap-3">
              <button className="btn-primary">Save justification</button>
              {!(req.classJustification ?? '').trim() && <span className="pill-stop">Required to submit</span>}
            </div>
          </form>
        </Card>
      )}

      {/* Existing lines */}
      <Card title={`Estimated Travel Costs (${req.expenses.length})`} className="mb-5">
        {req.expenses.length === 0 ? <Empty>No estimate lines yet — ODA and a hotel line per stop are added automatically once the trip has a destination and dates (set them on the Trip step). Add airfare from your quote below.</Empty> : isGroup ? (
          // §13.14 group: one collapsible row per cost item (expense type); expand to the
          // per-traveller breakdown. A shared/apportioned line shows one row per traveller (each
          // one's apportioned share), so the row count matches the travellers.
          <div className="space-y-2">
            {grouped.map((g) => {
              const rowCount = g.lines.reduce((n, e) => n + (e.isShared ? apportion(e).length : 1), 0);
              return (
                <details key={g.key} className="rounded border border-[var(--ecs-border)]">
                  <summary className="flex items-center justify-between px-3 py-2 cursor-pointer select-none bg-[var(--ecs-panel)] text-sm font-semibold text-[var(--ecs-navy)]">
                    <span>{g.name} <span className="font-normal text-[var(--ecs-muted)]">· {rowCount} traveller line{rowCount > 1 ? 's' : ''}</span></span>
                    <span className="whitespace-nowrap">{fmtSgd(g.gross)}</span>
                  </summary>
                  <table className="w-full text-sm">
                    <thead><tr>
                      <th className="th pl-6">Traveller</th><th className="th">City / Country</th><th className="th">From</th><th className="th">To</th>
                      <th className="th text-right">Nights</th><th className="th text-right">Rate</th><th className="th text-right">Total (SGD)</th>
                      <th className="th">Policy</th><th className="th"></th>
                    </tr></thead>
                    <tbody>
                      {g.lines.flatMap((e) =>
                        e.isShared
                          ? apportion(e).map((a, i) => (
                              <tr key={`${e.id}-${i}`} className="hover:bg-[var(--ecs-panel-2)]">
                                <td className="td text-xs text-[var(--ecs-navy-2)] pl-6 whitespace-nowrap">▸ {a.name}</td>
                                <td className="td text-xs">{i === 0 ? <>{cityCountryText(e)} <span className="pill-info ml-1">shared</span></> : <span className="text-[var(--ecs-muted)]">apportioned share</span>}</td>
                                <td className="td text-xs whitespace-nowrap">{i === 0 ? fmtD2(fromOf(e)) : ''}</td>
                                <td className="td text-xs whitespace-nowrap">{i === 0 ? fmtD2(toOf(e)) : ''}</td>
                                <td className="td text-right text-xs">{i === 0 ? (nightsOf(e) ?? '—') : ''}</td>
                                <td className="td text-right">{i === 0 ? <RateCell id={id} e={e} canEdit={canEdit} /> : ''}</td>
                                <td className="td text-right whitespace-nowrap">{fmtSgd(a.amount)}</td>
                                <td className="td">{i === 0 && (e.accommodation?.exceptionOutcome === POLICY_OUTCOME.Exception ? <OutcomePill outcome={POLICY_OUTCOME.Exception} /> : <OutcomePill outcome={POLICY_OUTCOME.Pass} />)}</td>
                                <td className="td text-right">{i === 0 && !e.autoDerived && canEdit && <form action={deleteExpense.bind(null, id, e.id)}><button className="btn-ghost text-xs">Remove</button></form>}</td>
                              </tr>
                            ))
                          : [
                              <tr key={e.id} className="hover:bg-[var(--ecs-panel-2)]">
                                <td className="td text-xs text-[var(--ecs-navy-2)] pl-6 whitespace-nowrap">▸ {attribution(e)}<AutoBadge e={e} /></td>
                                <td className="td text-xs">{cityCountryText(e)}</td>
                                <td className="td text-xs whitespace-nowrap">{fmtD2(fromOf(e))}</td>
                                <td className="td text-xs whitespace-nowrap">{fmtD2(toOf(e))}</td>
                                <td className="td text-right text-xs">{nightsOf(e) ?? '—'}</td>
                                <td className="td text-right"><RateCell id={id} e={e} canEdit={canEdit} /></td>
                                <td className="td text-right whitespace-nowrap">{fmtSgd(e.sgdAmount)}{e.sponsorSgd > 0 && <div className="text-xs text-[var(--ecs-muted)]">− {fmtSgd(e.sponsorSgd)} sponsor</div>}</td>
                                <td className="td">{e.accommodation?.exceptionOutcome === POLICY_OUTCOME.Exception ? <OutcomePill outcome={POLICY_OUTCOME.Exception} /> : <OutcomePill outcome={POLICY_OUTCOME.Pass} />}</td>
                                <td className="td text-right">{!e.autoDerived && canEdit && <form action={deleteExpense.bind(null, id, e.id)}><button className="btn-ghost text-xs">Remove</button></form>}</td>
                              </tr>,
                            ],
                      )}
                    </tbody>
                  </table>
                </details>
              );
            })}
            <div className="flex items-center justify-between px-3 py-2 font-semibold border-t border-[var(--ecs-border)] text-[var(--ecs-navy)]">
              <span>Gross estimate</span><span>{fmtSgd(summary.gross)}</span>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>
                <th className="th">Type</th><th className="th">City / Country</th><th className="th">From</th><th className="th">To</th>
                <th className="th text-right">Nights</th><th className="th text-right">Rate</th><th className="th text-right">Total (SGD)</th>
                <th className="th">Policy</th><th className="th"></th>
              </tr></thead>
              <tbody>
                {req.expenses.map((e) => (
                  <tr key={e.id} className="hover:bg-[var(--ecs-panel-2)]">
                    <td className="td font-medium whitespace-nowrap">{EcsReference.expenseType(e.expenseTypeId)?.name}<AutoBadge e={e} /></td>
                    <td className="td text-xs">{cityCountryText(e)}</td>
                    <td className="td text-xs whitespace-nowrap">{fmtD2(fromOf(e))}</td>
                    <td className="td text-xs whitespace-nowrap">{fmtD2(toOf(e))}</td>
                    <td className="td text-right text-xs">{nightsOf(e) ?? '—'}</td>
                    <td className="td text-right"><RateCell id={id} e={e} canEdit={canEdit} /></td>
                    <td className="td text-right whitespace-nowrap">{fmtSgd(e.sgdAmount)}{e.sponsorSgd > 0 && <div className="text-xs text-[var(--ecs-muted)]">− {fmtSgd(e.sponsorSgd)} sponsor</div>}</td>
                    <td className="td">{e.accommodation?.exceptionOutcome === POLICY_OUTCOME.Exception ? <OutcomePill outcome={POLICY_OUTCOME.Exception} /> : <OutcomePill outcome={POLICY_OUTCOME.Pass} />}</td>
                    <td className="td text-right">{!e.autoDerived && canEdit && <form action={deleteExpense.bind(null, id, e.id)}><button className="btn-ghost text-xs">Remove</button></form>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold"><td className="td" colSpan={6}>Gross estimate</td><td className="td text-right">{fmtSgd(summary.gross)}</td><td className="td" colSpan={2}></td></tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {canEdit && <div className="grid md:grid-cols-2 gap-5">
        {/* Airfare (TR-06) — manual: a quoted fare, not policy-derived. */}
        <Card title="Airfare (TR-06)">
          <p className="text-xs text-[var(--ecs-muted)] mb-2">Airfare is a <b>quoted fare</b> (not policy-derived) — add it from your quote.</p>
          <AddEstimatePanel action={addAirfare.bind(null, id)} label="Add airfare">
            <div className="grid grid-cols-2 gap-3">
              <Select name="originCode" label="Origin" defaultValue={tripDefaults.origin} opts={airports.map((a) => [a.code, a.code])} />
              <Select name="destCode" label="Destination" defaultValue={tripDefaults.destAirport} opts={airports.filter((a) => a.cityCode !== 'SIN').map((a) => [a.code, a.code])} />
              {isGroup ? (
                <div><label className="label">Proposed class</label><div className="field bg-[var(--ecs-panel)] text-[var(--ecs-muted)] cursor-not-allowed">Per traveller — set to entitlement</div></div>
              ) : (
                <Select name="proposedClassId" label="Proposed class" defaultValue={tripDefaults.classId} opts={travelClasses.map((c) => [c.id, c.name])} />
              )}
              <Input name="expectedDate" label="Expected date" type="date" defaultValue={tripDefaults.start} />
              <Select name="currency" label="Currency" defaultValue="SGD" opts={currencies.map((c) => [c, c])} />
              <Input name="amount" label="Quoted amount" type="number" />
              <Input name="sponsorship" label="Expected sponsorship" type="number" />
              {isGroup && <Select name="travellerId" label="Traveller (individual)" opts={gTravellers} />}
            </div>
            {!isGroup && (
              <div>
                <label className="label">Justification for higher class (required if above entitlement — §13.19)</label>
                <textarea name="classJustification" defaultValue={req.classJustification ?? ''} rows={2} className="field" placeholder="e.g. medical accommodation, red-eye connection…" />
                <p className="text-xs text-[var(--ecs-muted)] mt-1">Entitled: <strong>{entitledClassName}</strong> for this itinerary. Choosing a higher proposed class requires a justification.</p>
              </div>
            )}
            {/* #14 travel-class upgrade — only the funding choice is captured here. The entitlement fare
                and the upgrade differential are DERIVED (Model B) from the configured uplift % for the
                class step; the M6 account the NTU-funded delta charges is selected on the Charging step. */}
            {!isGroup && (
              <div className="rounded border border-[var(--ecs-border)] bg-[var(--ecs-panel-2)] p-3 space-y-2">
                <Select name="upgradeFunding" label="If above entitlement — upgrade funded by" defaultValue="NTU" opts={[['NTU', 'NTU — differential charged to an M6 account'], ['SELF', 'Self-funded — traveller pays the TMC']]} />
                <p className="text-xs text-[var(--ecs-muted)]">Only applies when the proposed class is above your <strong>{entitledClassName}</strong> entitlement. The entitlement fare and the upgrade differential are derived automatically from the configured uplift&nbsp;% for the class step (entitlement = chosen fare ÷ (1&nbsp;+&nbsp;uplift&nbsp;%)); the entitlement stays on your WBS/CC. <strong>NTU-funded</strong> charges the differential to an M6 account — select which on the Charging step; <strong>self-funded</strong> means you settle the differential with the TMC directly (not reimbursed).</p>
              </div>
            )}
            {/* §8 / DD-25 Guest travel-class upgrade — a guest booked above Economy needs a host-school
                Provost to authorise it; the Provost step is inserted ahead of the host DOA. */}
            {guestRequest && (
              <div className="rounded border border-[var(--ecs-border)] bg-[var(--ecs-panel-2)] p-3">
                <label className="label">Provost authorisation (required for a guest booked above Economy — §8 / DD-25)</label>
                <select name="provostId" defaultValue={req.provostId ?? ''} className="field">
                  <option value="">— No upgrade / Economy (no Provost needed) —</option>
                  {provostOptions.map((p) => <option key={p.id} value={p.approverId}>{p.name} · {p.title} ({EcsIdentity.department(p.schoolId)?.name ?? p.schoolId})</option>)}
                </select>
                <p className="text-xs text-[var(--ecs-muted)] mt-1">A guest flies <strong>Economy</strong> by default. Selecting a higher proposed class requires a justification <em>and</em> a Provost from the host school&apos;s list; approval routes to the Provost before the host DOA.{guestUpgrading && !req.provostId && <span className="text-[var(--ecs-red)]"> This guest is above Economy — select a Provost.</span>}</p>
              </div>
            )}
            <button className="btn-primary w-full">Add airfare estimate</button>
          </AddEstimatePanel>
        </Card>

        {/* Accommodation (TR-07) — auto per stop; a manual extra line can still be added. */}
        <Card title="Accommodation (TR-07)">
          <p className="text-xs text-[var(--ecs-muted)] mb-2">A hotel line is <b>added automatically for each overnight stop</b> at the city&apos;s cap (editable rate, locked stay) and re-derives if you change the dates. Add a line below only for an extra/manual stay.</p>
          {/* DD-19 hotel payment channel — CTA (central) only when the trip is a TMC arrangement. */}
          <div className="rounded border border-[var(--ecs-border)] bg-[var(--ecs-panel)] p-2.5 mb-3">
            <form action={setHotelSettlement.bind(null, id)} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-[var(--ecs-muted)]">Hotel paid by:</span>
              <button name="hotelSettlement" value="INDIVIDUAL" className={`text-xs ${req.hotelSettlement === 'CTA' ? 'btn-secondary' : 'btn-primary'}`}>Individual (claim)</button>
              {isTmcArrangement(req.bookingArrangement)
                ? <button name="hotelSettlement" value="CTA" className={`text-xs ${req.hotelSettlement === 'CTA' ? 'btn-primary' : 'btn-secondary'}`}>Central Travel Account (CTA)</button>
                : <span className="text-xs text-[var(--ecs-muted)] italic">CTA is available only for a TMC-arranged trip</span>}
            </form>
            <p className="text-xs text-[var(--ecs-muted)] mt-1.5">{req.hotelSettlement === 'CTA'
              ? 'Hotel is centrally billed to the CTA — shown in the expense claim for reference only, not reimbursed to the traveller.'
              : 'Hotel is paid by the traveller and claimed back (reimbursable). Airfare is always on the CTA; ODA is always claimed.'}</p>
          </div>
          <AddEstimatePanel action={addAccommodation.bind(null, id)} label="Add accommodation (extra)">
            <div className="grid grid-cols-2 gap-3">
              <AccommodationCityRate cities={cities.filter((c) => c.code !== 'SIN').map((c) => [c.code, c.name])} caps={capByCity} defaultCity={tripDefaults.destCity} />
              <Input name="nights" label="Nights" type="number" defaultValue={tripDefaults.nights} />
              <Input name="personalNights" label="Personal nights" type="number" defaultValue="0" />
              <Input name="checkIn" label="Check-in" type="date" defaultValue={tripDefaults.start} />
              <Input name="checkOut" label="Check-out" type="date" defaultValue={tripDefaults.end} />
            </div>
            <Input name="notes" label="Justification / note — explain here if the nightly rate is above the city cap (shown to the approver)" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="conferenceHotel" /> Conference hotel</label>
            {isGroup && <Select name="travellerId" label="Traveller" opts={gTravellers} />}
            {isGroup && <p className="text-xs text-[var(--ecs-muted)]">Each traveller books, pays and claims their own room — one line per traveller (choose All travellers to add for everyone).</p>}
            <p className="text-xs text-[var(--ecs-muted)]">The rate <b>defaults to the selected city&apos;s cap</b> and is editable; the estimate budgets at the <b>lower of the quoted rate and the cap</b> (a rate above the cap is capped and needs a justification). Caps — {hotelCaps.filter((h) => h.cityCode !== 'SIN').map((h) => `${h.cityCode} ${fmtSgd(h.capNightlySgd)}`).join(', ')}.</p>
            <button className="btn-primary w-full">Add accommodation estimate</button>
          </AddEstimatePanel>
        </Card>

        {/* ODA (TR-08) — §8 not available to guests */}
        {guestRequest ? (
          <Card title="Add ODA (TR-08)">
            <p className="text-sm text-[var(--ecs-muted)]">ODA (overseas daily allowance) does not apply to a guest — it is not a guest entitlement and is settled centrally (§8). Guest cost is airfare and accommodation only.</p>
          </Card>
        ) : (
        <Card title="ODA (TR-08) — automatic">
          <p className="text-sm text-[var(--ecs-muted)]">ODA (overseas daily allowance) is <b>policy-based</b> and added <b>automatically</b> — <b>one line per city</b>, at that country&apos;s <b>full daily rate</b> × nights — for {isGroup ? 'each employee traveller' : 'the traveller'}, from the itinerary. It is <b>not edited here</b>; change the dates or stops on the <b>Trip</b> step to adjust it.</p>
          <p className="text-xs text-[var(--ecs-muted)] mt-2">Rates — {odaRates.map((o) => `${o.countryCode} ${fmtSgd(o.dailyRateSgd)}/day`).join(', ')}.</p>
        </Card>
        )}

        {/* Incidental (only when expense scope = ALL) */}
        {allowIncidental && (
          <Card title="Other / Conference Fee">
            <AddEstimatePanel action={addOther.bind(null, id)} label="Add other / conference fee">
              <div className="grid grid-cols-2 gap-3">
                <Select name="expenseTypeId" label="Expense type" opts={expenseTypes.filter((t) => !t.isMajorCost).map((t) => [t.id, t.name])} />
                <Select name="currency" label="Currency" defaultValue="SGD" opts={currencies.map((c) => [c, c])} />
                <Input name="amount" label="Amount" type="number" />
                <Input name="notes" label="Note" />
                {isGroup && <Select name="travellerId" label="Traveller (if individual)" opts={gTravellers} />}
                {isGroup && <label className="flex items-center gap-2 text-sm pb-2"><input type="checkbox" name="shared" /> Shared — apportion</label>}
              </div>
              <button className="btn-primary w-full">Add incidental estimate</button>
            </AddEstimatePanel>
          </Card>
        )}
      </div>}

      <div className="flex justify-between mt-5">
        <Link href={`/requests/${id}/trip`} className="btn-secondary">← Back</Link>
        <div className="flex gap-2">
          {canEdit && <Link href="/dashboard" className="btn-secondary" title="Your estimates are saved — return to the dashboard and finish later">Save as draft</Link>}
          <Link href={`/requests/${id}/charging`} className="btn-primary">Continue to charging →</Link>
        </div>
      </div>
    </div>
  );
}

// Rate cell for an estimate line. An AUTO hotel line exposes an inline nightly-rate edit (the stay is
// locked); every other line shows a static per-night / per-day rate, or "—" where rate doesn't apply.
function RateCell({ id, e, canEdit }: { id: string; e: { id: string; autoDerived: boolean; notes: string | null; accommodation: { quotedNightly: number; capNightly: number } | null; oda: { dailyRate: number } | null }; canEdit: boolean }) {
  if (e.accommodation) {
    const over = e.accommodation.capNightly > 0 && e.accommodation.quotedNightly > e.accommodation.capNightly;
    if (e.autoDerived && canEdit) {
      return (
        <form action={updateAccommodationRate.bind(null, id, e.id)} className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-1 justify-end">
            <span className="text-xs text-[var(--ecs-muted)]">$</span>
            <input name="quotedNightly" type="number" step="any" defaultValue={e.accommodation.quotedNightly} aria-label="Nightly rate" className="field !w-16 !py-1 !px-1.5 text-xs text-right" />
            <button className="btn-ghost text-xs" title="Update nightly rate">Set</button>
          </div>
          {/* Above-cap rates require a justification (enforced at submit); captured inline here. */}
          <input name="justification" defaultValue={e.notes ?? ''} aria-label="Above-cap justification"
            placeholder={`Justification if > ${fmtSgd(e.accommodation.capNightly)} cap`}
            className={`field !py-1 !px-1.5 text-[11px] !w-48 ${over && !(e.notes ?? '').trim() ? '!border-[var(--ecs-red)]' : ''}`} />
        </form>
      );
    }
    return <span className="text-xs whitespace-nowrap">{fmtSgd(e.accommodation.quotedNightly)}<span className="text-[var(--ecs-muted)]">/n</span>{over && <span className="text-[var(--ecs-red)]" title="Above cap"> ⚠</span>}</span>;
  }
  if (e.oda) return <span className="text-xs whitespace-nowrap">{fmtSgd(e.oda.dailyRate)}<span className="text-[var(--ecs-muted)]">/day</span></span>;
  return <span className="text-xs text-[var(--ecs-muted)]">—</span>;
}
function AutoBadge({ e }: { e: { autoDerived: boolean } }) {
  return e.autoDerived ? <span className="pill-info ml-1" title="Policy-derived from the itinerary — re-derived if you change the travel dates">Auto</span> : null;
}
function Input({ name, label, type = 'text', defaultValue }: { name: string; label: string; type?: string; defaultValue?: string }) {
  return <div><label className="label">{label}</label><input name={name} type={type} step="any" defaultValue={defaultValue} className="field" /></div>;
}
function Select({ name, label, opts, defaultValue }: { name: string; label: string; opts: [string, string][]; defaultValue?: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      <select name={name} defaultValue={defaultValue ?? ''} className="field">
        {!defaultValue && <option value="">Select…</option>}
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

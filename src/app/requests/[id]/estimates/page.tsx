// TR-05..08 Estimated Travel Costs — airfare, accommodation (with cap), ODA and
// permitted incidental costs. Reuses the TE expense pattern; receipt fields replaced
// by expected date, estimate basis and quotation (§4.4/§4.5).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadRequest } from '@/modules/pretrip/queries';
import { getSettings } from '@/modules/pretrip/settings';
import { currentPersonaId } from '@/shared/session';
import { canEditRequest } from '@/modules/pretrip/guards';
import { addAirfare, addAccommodation, addOda, addOther, deleteExpense } from '@/modules/pretrip/actions';
import { EcsReference, EcsIdentity } from '@/shared/ecs/services';
import { computeSummary, computeOda, fmtSgd } from '@/modules/pretrip/pricing';
import { countries, cities, airports } from '@/data/locations';
import { travelClasses } from '@/data/travelClass';
import { hotelCaps, odaRates } from '@/data/policyRates';
import { currencies } from '@/data/fxRates';
import { expenseTypes } from '@/data/expenseTypes';
import { EXPENSE_CATEGORY, POLICY_OUTCOME } from '@/shared/enums';
import { Card, Stepper, Empty } from '@/components/ui';
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
  // Auto-computed ODA preview for this trip (policy rate × eligible days over the official range).
  const odaPreview = req.destCountry && req.startDate && req.endDate
    ? computeOda({ countryCode: req.destCountry, arrive: req.startDate, depart: req.endDate, personalDays: 0 })
    : null;
  const isGroup = req.isGroup;
  // §13.14 group traveller options for individual lines, with an "All travellers" fan-out
  // (creates one line per traveller in a single submit) to speed up group request creation.
  const gTravellers: [string, string][] = [
    ['__ALL__', `All travellers (${req.travellers.length}) — one line each`],
    ...req.travellers.map((t) => [t.employeeId, EcsIdentity.employee(t.employeeId)?.name ?? t.employeeId] as [string, string]),
  ];
  const attribution = (e: { isShared: boolean; travellerId: string | null }) =>
    e.isShared ? 'Shared (apportioned)' : (EcsIdentity.employee(e.travellerId ?? '')?.name ?? '—');
  // §13.14 a genuinely shared line (e.g. a shared taxi) is shown apportioned across the group —
  // one row per traveller at their share (shareMap, else an equal split). Accommodation is no
  // longer shared (each traveller books their own room), so this applies only to shared incidentals.
  const apportion = (e: { sgdAmount: number; shareMap: string | null }) => {
    let sm: Record<string, number> = {};
    try { sm = e.shareMap ? JSON.parse(e.shareMap) : {}; } catch { sm = {}; }
    const entries = Object.entries(sm);
    const list = entries.length
      ? entries.map(([eid, pct]) => ({ eid, amount: e.sgdAmount * Number(pct) / 100 }))
      : req.travellers.map((t) => ({ eid: t.employeeId, amount: e.sgdAmount / (req.travellers.length || 1) }));
    return list.map((x) => ({ name: EcsIdentity.employee(x.eid)?.name ?? x.eid, amount: x.amount }));
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

  return (
    <div>
      <Stepper id={id} active="estimates" />
      {error && <div className="card p-3 mb-4 text-sm text-red-800 bg-red-50 border-red-200">{error}</div>}
      {!canEdit && <div className="card p-3 mb-4 text-sm text-amber-900 bg-amber-50 border-amber-200">Read-only view — your role cannot edit this request's estimates.</div>}

      {/* Existing lines */}
      <Card title={`Estimated Travel Costs (${req.expenses.length})`} className="mb-5">
        {req.expenses.length === 0 ? <Empty>No estimate lines yet — add airfare, accommodation and ODA below.</Empty> : isGroup ? (
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
                    <tbody>
                      {g.lines.flatMap((e) =>
                        e.isShared
                          ? apportion(e).map((a, i) => (
                              <tr key={`${e.id}-${i}`} className="hover:bg-[var(--ecs-panel-2)]">
                                <td className="td text-xs text-[var(--ecs-navy-2)] pl-6 whitespace-nowrap">▸ {a.name}</td>
                                <td className="td text-xs text-[var(--ecs-muted)]">{i === 0 ? <><LineDetail e={e} /> <span className="pill-info ml-1">shared · apportioned</span></> : 'apportioned share'}</td>
                                <td className="td text-right whitespace-nowrap">{fmtSgd(a.amount)}</td>
                                <td className="td">{i === 0 && (e.accommodation?.exceptionOutcome === POLICY_OUTCOME.Exception ? <OutcomePill outcome={POLICY_OUTCOME.Exception} /> : <OutcomePill outcome={POLICY_OUTCOME.Pass} />)}</td>
                                <td className="td text-right">{i === 0 && canEdit && <form action={deleteExpense.bind(null, id, e.id)}><button className="btn-ghost text-xs">Remove</button></form>}</td>
                              </tr>
                            ))
                          : [
                              <tr key={e.id} className="hover:bg-[var(--ecs-panel-2)]">
                                <td className="td text-xs text-[var(--ecs-navy-2)] pl-6 whitespace-nowrap">▸ {attribution(e)}</td>
                                <td className="td text-xs text-[var(--ecs-muted)]"><LineDetail e={e} /></td>
                                <td className="td text-right whitespace-nowrap">{fmtSgd(e.sgdAmount)}{e.sponsorSgd > 0 && <div className="text-xs text-[var(--ecs-muted)]">− {fmtSgd(e.sponsorSgd)} sponsor</div>}</td>
                                <td className="td">{e.accommodation?.exceptionOutcome === POLICY_OUTCOME.Exception ? <OutcomePill outcome={POLICY_OUTCOME.Exception} /> : <OutcomePill outcome={POLICY_OUTCOME.Pass} />}</td>
                                <td className="td text-right">{canEdit && <form action={deleteExpense.bind(null, id, e.id)}><button className="btn-ghost text-xs">Remove</button></form>}</td>
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
              <thead><tr><th className="th">Type</th><th className="th">Detail</th><th className="th text-right">Amount (SGD)</th><th className="th">Policy</th><th className="th"></th></tr></thead>
              <tbody>
                {req.expenses.map((e) => (
                  <tr key={e.id} className="hover:bg-[var(--ecs-panel-2)]">
                    <td className="td font-medium">{EcsReference.expenseType(e.expenseTypeId)?.name}</td>
                    <td className="td text-xs text-[var(--ecs-muted)]"><LineDetail e={e} /></td>
                    <td className="td text-right whitespace-nowrap">{fmtSgd(e.sgdAmount)}{e.sponsorSgd > 0 && <div className="text-xs text-[var(--ecs-muted)]">− {fmtSgd(e.sponsorSgd)} sponsor</div>}</td>
                    <td className="td">{e.accommodation?.exceptionOutcome === POLICY_OUTCOME.Exception ? <OutcomePill outcome={POLICY_OUTCOME.Exception} /> : <OutcomePill outcome={POLICY_OUTCOME.Pass} />}</td>
                    <td className="td text-right">{canEdit && <form action={deleteExpense.bind(null, id, e.id)}><button className="btn-ghost text-xs">Remove</button></form>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold"><td className="td" colSpan={2}>Gross estimate</td><td className="td text-right">{fmtSgd(summary.gross)}</td><td className="td" colSpan={2}></td></tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {canEdit && <div className="grid md:grid-cols-2 gap-5">
        {/* Airfare (TR-06) */}
        <Card title="Add Airfare (TR-06)">
          <form action={addAirfare.bind(null, id)} className="space-y-3">
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
            <button className="btn-secondary w-full">Add airfare estimate</button>
          </form>
        </Card>

        {/* Accommodation (TR-07) */}
        <Card title="Add Accommodation (TR-07)">
          <form action={addAccommodation.bind(null, id)} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Select name="city" label="City" defaultValue={tripDefaults.destCity} opts={cities.filter((c) => c.code !== 'SIN').map((c) => [c.code, c.name])} />
              <Input name="quotedNightly" label="Quoted rate / night" type="number" />
              <Input name="nights" label="Nights" type="number" defaultValue={tripDefaults.nights} />
              <Input name="personalNights" label="Personal nights" type="number" defaultValue="0" />
              <Input name="checkIn" label="Check-in" type="date" defaultValue={tripDefaults.start} />
              <Input name="checkOut" label="Check-out" type="date" defaultValue={tripDefaults.end} />
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="conferenceHotel" /> Conference hotel</label>
            {isGroup && <Select name="travellerId" label="Traveller" opts={gTravellers} />}
            {isGroup && <p className="text-xs text-[var(--ecs-muted)]">Each traveller books, pays and claims their own room — one line per traveller (choose All travellers to add for everyone).</p>}
            <p className="text-xs text-[var(--ecs-muted)]">Basis: {settings.hotelEstimateBasis}. Caps — {hotelCaps.filter((h) => h.cityCode !== 'SIN').map((h) => `${h.cityCode} ${fmtSgd(h.capNightlySgd)}`).join(', ')}.</p>
            <button className="btn-secondary w-full">Add accommodation estimate</button>
          </form>
        </Card>

        {/* ODA (TR-08) */}
        <Card title="Add ODA (TR-08)">
          <form action={addOda.bind(null, id)} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Select name="country" label="Country" defaultValue={tripDefaults.destCountry} opts={countries.filter((c) => c.code !== 'SG').map((c) => [c.code, c.name])} />
              <Select name="city" label="City" defaultValue={tripDefaults.destCity} opts={cities.filter((c) => c.code !== 'SIN').map((c) => [c.code, c.name])} />
              <Input name="arrive" label="Arrival" type="date" defaultValue={tripDefaults.start} />
              <Input name="depart" label="Departure" type="date" defaultValue={tripDefaults.end} />
              <Input name="personalDays" label="Personal days" type="number" defaultValue="0" />
              {isGroup && <Select name="travellerId" label="Traveller (individual)" opts={gTravellers} />}
            </div>
            {odaPreview && odaPreview.dailyRate > 0 && (
              <p className="text-xs text-[var(--ecs-navy-2)]">Auto-computed for this trip: <strong>{fmtSgd(odaPreview.sgdAmount)}</strong> ({odaPreview.eligibleDays} eligible days @ {fmtSgd(odaPreview.dailyRate)}/day over {tripDefaults.start} → {tripDefaults.end}). Adjust dates/personal days to recompute.</p>
            )}
            <p className="text-xs text-[var(--ecs-muted)]">Indicative estimate; excludes personal days. Rates — {odaRates.map((o) => `${o.countryCode} ${fmtSgd(o.dailyRateSgd)}/day`).join(', ')}.</p>
            <button className="btn-secondary w-full">Add ODA estimate</button>
          </form>
        </Card>

        {/* Incidental (only when expense scope = ALL) */}
        {allowIncidental && (
          <Card title="Add Other / Conference Fee">
            <form action={addOther.bind(null, id)} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Select name="expenseTypeId" label="Expense type" opts={expenseTypes.filter((t) => !t.isMajorCost).map((t) => [t.id, t.name])} />
                <Select name="currency" label="Currency" defaultValue="SGD" opts={currencies.map((c) => [c, c])} />
                <Input name="amount" label="Amount" type="number" />
                <Input name="notes" label="Note" />
                {isGroup && <Select name="travellerId" label="Traveller (if individual)" opts={gTravellers} />}
                {isGroup && <label className="flex items-center gap-2 text-sm pb-2"><input type="checkbox" name="shared" /> Shared — apportion</label>}
              </div>
              <button className="btn-secondary w-full">Add incidental estimate</button>
            </form>
          </Card>
        )}
      </div>}

      <div className="flex justify-between mt-5">
        <Link href={`/requests/${id}/trip`} className="btn-secondary">← Back</Link>
        <Link href={`/requests/${id}/charging`} className="btn-primary">Continue to charging →</Link>
      </div>
    </div>
  );
}

type ExpenseRow = {
  category: string; originCode: string | null; destCode: string | null; proposedClassId: string | null;
  accommodation: { city: string; nights: number; quotedNightly: number; capNightly: number } | null;
  oda: { country: string; eligibleDays: number; dailyRate: number } | null;
  notes: string | null;
};
function LineDetail({ e }: { e: ExpenseRow }) {
  return (
    <>
      {e.category === EXPENSE_CATEGORY.Airfare && `${e.originCode ?? ''} → ${e.destCode ?? ''} · ${EcsReference.travelClass(e.proposedClassId ?? '')?.name ?? ''}`}
      {e.accommodation && `${EcsReference.city(e.accommodation.city)?.name ?? e.accommodation.city} · ${e.accommodation.nights}n · quoted ${fmtSgd(e.accommodation.quotedNightly)}/n vs cap ${fmtSgd(e.accommodation.capNightly)}/n`}
      {e.oda && `${EcsReference.country(e.oda.country)?.name} · ${e.oda.eligibleDays} eligible days @ ${fmtSgd(e.oda.dailyRate)}/day`}
      {(e.category === EXPENSE_CATEGORY.Other || e.category === EXPENSE_CATEGORY.Conference) ? (e.notes ?? '') : ''}
    </>
  );
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

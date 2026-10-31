// TR-05..08 Estimated Travel Costs — airfare, accommodation (with cap), ODA and
// permitted incidental costs. Reuses the TE expense pattern; receipt fields replaced
// by expected date, estimate basis and quotation (§4.4/§4.5).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadRequest } from '@/modules/pretrip/queries';
import { getSettings } from '@/modules/pretrip/settings';
import { currentPersonaId } from '@/shared/session';
import { canEditRequest } from '@/modules/pretrip/guards';
import { addAirfare, addAirfareLegs, addAccommodation, addOther, deleteExpense, updateAccommodationRate, setHotelSettlement, updateAirfare, updateAccommodation, updateOther } from '@/modules/pretrip/actions';
import { EcsReference, EcsIdentity } from '@/shared/ecs/services';
import { memberName, isGuestRequest, isNonEmployeeMember, isStudentMember } from '@/modules/pretrip/traveller';
type TagRef = { travellerType?: string | null; employeeId: string };
/** " · student" / " · guest" / "" — the non-employee label suffix for a member, with a chosen separator. */
const memberTag = (t: TagRef, sep: string) => isStudentMember(t) ? `${sep}student` : (isNonEmployeeMember(t) ? `${sep}guest` : '');
import { isTmcArrangement } from '@/modules/pretrip/booking';
import { provostsForSchool } from '@/modules/pretrip/provost';
import { AccommodationCityRate } from '@/components/AccommodationCityRate';
import { EstimateCostAdd } from '@/components/EstimateCostAdd';
import { AirfareForm } from '@/components/AirfareForm';
import { CostItems } from '@/components/ReviewSections';
import { makeEntitledClassFor, makeOutcomeFor } from '@/modules/pretrip/liveOutcome';
import { computeSummary, fmtSgd } from '@/modules/pretrip/pricing';
import { cities, airports } from '@/data/locations';
import { travelClasses } from '@/data/travelClass';
import { hotelCaps } from '@/data/policyRates';
import { expenseTypes } from '@/data/expenseTypes';
import { EXPENSE_CATEGORY } from '@/shared/enums';
import { Card, Stepper, Empty } from '@/components/ui';
import { DuplicateWarning } from '@/components/DuplicateWarning';

export const dynamic = 'force-dynamic';

export default async function EstimatesStep({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; edit?: string }> }) {
  const { id } = await params;
  const { error, edit } = await searchParams;
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
  // §13.20 headline destination for a one-ticket fare = the MAIN (longest-stay) destination's airport,
  // taken from the itinerary leg that actually lands there — not the first leg's arrival (which may be
  // a short connection). Falls back to the main-city airport, then the first leg's destination.
  const mainDestLeg = sharedLegs.find((l) => airports.find((a) => a.code === l.destCode)?.cityCode === req.destCity);
  const tripDefaults = {
    origin: firstLeg?.originCode ?? 'SIN',
    destAirport: mainDestLeg?.destCode || destAirport || firstLeg?.destCode || '',
    classId: req.travelClassId ?? '',
    destCity: req.destCity ?? '',
    destCountry: req.destCountry ?? '',
    start: d(req.startDate),
    end: d(req.endDate),
    nights: req.startDate && req.endDate ? String(Math.max(Math.round((req.endDate.getTime() - req.startDate.getTime()) / 86400000), 0)) : '',
  };
  // Airfare "expected date of travel" = the flight date, derived from the itinerary (never hand-keyed
  // on the line). For a line that maps to a sector, use that leg's departure; otherwise (a combined
  // through-ticket) the first leg's departure. Shown read-only on the airfare form.
  const airfareDepart = (origin?: string | null, dest?: string | null) => {
    const leg = sharedLegs.find((l) => l.originCode === origin && l.destCode === dest);
    return d(leg?.departDate ?? null) || d(firstLeg?.departDate ?? null) || d(req.startDate);
  };
  const isGroup = req.isGroup;
  // §13.20 multi-leg airfare — a multi-city trip can be booked EITHER as one combined through-ticket
  // (one fare for the whole routing) OR as separate per-leg tickets (one airfare line per sector).
  // The note below lists the full itinerary (from the legs) and explains both options; the single
  // Origin/Destination stays EDITABLE so the traveller sets the ticketed endpoints.
  const isMultiCity = req.tripType === 'MULTI_CITY';
  const airLegs = isMultiCity ? sharedLegs.map((l) => ({ from: l.originCode ?? '', to: l.destCode ?? '', date: l.departDate ? d(l.departDate) : '' })) : [];
  const airfareMultiCityNote = isMultiCity ? (
    <div className="rounded border border-[var(--ecs-border)] bg-[var(--ecs-panel-2)] p-3 text-xs space-y-1.5">
      <p>A multi-city trip can be booked as <b>one combined ticket</b> (one fare for the whole routing) or as <b>separate tickets per leg</b> (add one airfare line per sector, each with its own Origin / Destination and fare).</p>
      <div>
        <span className="font-semibold text-[var(--ecs-navy)]">Full itinerary</span>
        <ul className="mt-0.5 space-y-0.5 font-mono text-[11px] text-[var(--ecs-muted)]">
          {airLegs.map((l, i) => <li key={i}>Leg {i + 1}: {l.from} → {l.to}{l.date ? ` · ${l.date}` : ''}</li>)}
        </ul>
      </div>
      <p className="text-[var(--ecs-muted)]">Booking as <b>one combined ticket</b>? Enter the <b>total quoted fare</b> below. <b>Departure from</b> / <b>Primary destination</b> are <b>editable</b> and name the main place you&apos;re travelling to (not the return-home endpoint); the full route above is carried into the booking from the itinerary.</p>
    </div>
  ) : null;
  const costTitle = `Estimated ${isGroup ? 'Group ' : ''}Travel Cost Items`;
  const emptyNote = 'No estimate lines yet — ODA and a hotel line per stop are added automatically once the trip has a destination and dates (set them on the Trip step). Add airfare from your quote below.';
  // §13.19 the individual traveller's derived entitlement — the baseline the airfare form gates the
  // upgrade justification against (the stored entitledClassId is often null, so derive it live).
  const indivEntitledId = isGroup ? 'TC-ECO' : makeEntitledClassFor(req)(req.travellerId);
  const indivEntitledName = travelClasses.find((c) => c.id === indivEntitledId)?.name ?? 'Economy';
  // M6 (entitlement differential) is a CHARGING concern — explained in full on the Charging step.
  // It is deliberately NOT surfaced on the airfare form: the traveller flies their entitlement and
  // need not think about which account funds the Economy→entitled portion at estimate time.

  // Controls shown inside each cost row's expanded breakdown on the Estimates step: the auto hotel
  // nightly-rate edit, or Edit / Remove for a manual line (auto ODA has none).
  const lineActions = (e: (typeof req.expenses)[number]) => {
    if (!canEdit) return null;
    if (e.autoDerived) return e.accommodation ? <RateCell id={id} e={e} canEdit={canEdit} /> : null;
    return (
      <span className="inline-flex items-center gap-1">
        <Link href={editLink(e.id)} className="btn-ghost text-xs">Edit</Link>
        <form action={deleteExpense.bind(null, id, e.id)}><button className="btn-ghost text-xs">Remove</button></form>
      </span>
    );
  };
  // Live policy outcome per expense type — airfare above the derived entitlement, or accommodation
  // above the city cap — so the estimate shows the deviation without waiting for a policy run.
  const outcomeFor = makeOutcomeFor(req);
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
  // Label a traveller (or the requestor) for the group airfare/accommodation edit forms.
  const memberLabel = (key: string | null) => {
    const t = req.travellers.find((x) => x.employeeId === key);
    return t ? memberName(t) + memberTag(t, ' · ') : (EcsIdentity.employee(key ?? '')?.name ?? '—');
  };

  // Edit-in-place: ?edit=<lineId> opens that line's category tab pre-filled with its current values,
  // and the form updates the line (no duplicate). Only a manual (non-auto) airfare / accommodation /
  // other line is editable — auto hotel lines edit their rate inline and ODA re-derives from the Trip.
  const editExp = canEdit && edit ? req.expenses.find((e) => e.id === edit && !e.autoDerived && e.category !== EXPENSE_CATEGORY.ODA) ?? null : null;
  const editKind = editExp ? (editExp.category === EXPENSE_CATEGORY.Airfare ? 'airfare' : editExp.category === EXPENSE_CATEGORY.Accommodation ? 'accommodation' : 'other') : null;
  const af = editKind === 'airfare' ? editExp! : null;
  const ac = editKind === 'accommodation' ? editExp! : null;
  const accRec = ac?.accommodation ?? null;
  const ot = editKind === 'other' ? editExp! : null;
  const editTravellerLabel = editExp && editExp.travellerId ? memberLabel(editExp.travellerId) : null;
  // Cancel on any add/edit form: returns to the clean estimates page, which collapses the form
  // (and clears any ?edit). Shown on add forms too so the panel can be dismissed.
  const cancelLink = <Link href={`/requests/${id}/estimates`} className="btn-secondary text-xs">Cancel</Link>;
  const editLink = (eid: string) => `/requests/${id}/estimates?edit=${eid}#add-cost`;

  return (
    <div>
      <Stepper id={id} active="estimates" requestNumber={req.requestNumber} status={req.status} />
      {error && <div className="card p-3 mb-4 text-sm text-red-800 bg-red-50 border-red-200">{error}</div>}
      <DuplicateWarning req={req} />
      {!canEdit && <div className="card p-3 mb-4 text-sm text-amber-900 bg-amber-50 border-amber-200">Read-only view — your role cannot edit this request's estimates.</div>}

      {/* §13.19 the class-upgrade justification is entered on the airfare form itself (gated there) and
          can be edited on the Policy Review step; no standalone card is shown here. */}

      {/* Existing lines + inline add — one card. The expandable cost-items table (Basis,
          Sponsorship/Personal, NTU-funded and a live Policy Outcome; each row expands to the
          per-traveller computation) shares its header bar with the "Add a cost line" tabs, which
          sit on the LEFT of the bar beside the title. Read-only roles see the table without tabs. */}
      {canEdit ? (
      <div className="mb-5"><EstimateCostAdd
        title={costTitle}
        defaultActive={editKind}
        editSignal={edit ?? ''}
        tabs={[
        // Airfare (TR-06) — manual: a quoted fare, not policy-derived. A GROUP books each traveller at
        // their entitlement (class locked) → server form; an INDIVIDUAL/guest can pick a class, so it
        // uses the client AirfareForm which gates the Add button on the upgrade justification (§13.19).
        { key: 'airfare', label: 'Airfare', node: isGroup ? (
          <form action={af ? updateAirfare.bind(null, id, af.id) : addAirfare.bind(null, id)} className="space-y-3">
            <FormBar title={af ? <>Editing this airfare line{editTravellerLabel ? <> for <b>{editTravellerLabel}</b></> : null} — change the values and save.</> : <>Airfare is a <b>quoted fare</b> (not policy-derived) — add it from your quote.</>}>
              {cancelLink}
              <button className="btn-primary">{af ? 'Save airfare changes' : 'Add airfare estimate'}</button>
            </FormBar>
            {airfareMultiCityNote}
            <div className="grid grid-cols-2 gap-3">
              <Select name="originCode" label={isMultiCity ? 'Departure from' : 'Origin'} defaultValue={af?.originCode ?? tripDefaults.origin} opts={airports.map((a) => [a.code, a.code])} />
              <Select name="destCode" label={isMultiCity ? 'Primary destination' : 'Destination'} defaultValue={af?.destCode ?? tripDefaults.destAirport} opts={airports.filter((a) => a.cityCode !== 'SIN').map((a) => [a.code, a.code])} />
              <div><label className="label">Proposed class</label><div className="field bg-[var(--ecs-panel)] text-[var(--ecs-muted)] cursor-not-allowed">Per traveller — set to entitlement</div></div>
              {/* Read-only flight date — derived from the itinerary, changed on the Trip step (not keyed here). */}
              <div>
                <label className="label">Expected date of travel</label>
                <div className="field bg-[var(--ecs-panel)] text-[var(--ecs-muted)] cursor-not-allowed flex items-center justify-between gap-2">
                  <span>{(af ? airfareDepart(af.originCode, af.destCode) : airfareDepart(firstLeg?.originCode, firstLeg?.destCode)) || 'Set on the Trip step'}</span>
                  <span className="text-[11px] whitespace-nowrap">from the itinerary</span>
                </div>
                <input type="hidden" name="expectedDate" value={af ? airfareDepart(af.originCode, af.destCode) : airfareDepart(firstLeg?.originCode, firstLeg?.destCode)} />
              </div>
              <input type="hidden" name="currency" value="SGD" />
              <Input name="amount" label="Quoted amount (SGD)" type="number" defaultValue={af ? String(af.foreignAmount) : undefined} />
              <Input name="sponsorship" label="Expected sponsorship" type="number" defaultValue={af ? String(af.sponsorForeign ?? 0) : undefined} />
              {!af && <Select name="travellerId" label="Traveller (individual)" opts={gTravellers} />}
              {af && <div><label className="label">Traveller</label><div className="field bg-[var(--ecs-panel)] text-[var(--ecs-muted)]">{editTravellerLabel ?? '—'}</div></div>}
            </div>
          </form>
        ) : (
          <AirfareForm
            action={af ? updateAirfare.bind(null, id, af.id) : addAirfare.bind(null, id)}
            submitLabel={af ? 'Save airfare changes' : 'Add airfare estimate'}
            editing={!!af}
            cancel={cancelLink}
            multiCity={isMultiCity}
            multiCityNote={airfareMultiCityNote}
            legAction={isMultiCity ? addAirfareLegs.bind(null, id) : undefined}
            legs={isMultiCity ? airLegs.map((l) => [l.from, l.to] as [string, string]) : undefined}
            originOpts={airports.map((a) => [a.code, a.code])}
            destOpts={airports.filter((a) => a.cityCode !== 'SIN').map((a) => [a.code, a.code])}
            classOpts={travelClasses.map((c) => [c.id, c.name])}
            classRanks={Object.fromEntries(travelClasses.map((c) => [c.id, c.rank]))}
            defaults={{
              origin: af?.originCode ?? tripDefaults.origin,
              dest: af?.destCode ?? tripDefaults.destAirport,
              proposedClassId: af?.proposedClassId ?? (req.travelClassId || indivEntitledId),
              expectedDate: af ? airfareDepart(af.originCode, af.destCode) : airfareDepart(firstLeg?.originCode, firstLeg?.destCode),
              currency: af?.currency ?? 'SGD',
              amount: af ? String(af.foreignAmount) : '',
              sponsorship: af ? String(af.sponsorForeign ?? 0) : '',
              classJustification: req.classJustification ?? '',
              upgradeFunding: af?.upgradeFunding ?? 'NTU',
            }}
            entitledClassId={indivEntitledId}
            entitledClassName={indivEntitledName}
            guest={guestRequest}
            provostOpts={provostOptions.map((p) => ({ approverId: p.approverId, name: p.name, title: p.title, dept: EcsIdentity.department(p.schoolId)?.name ?? p.schoolId }))}
            provostDefault={req.provostId ?? ''}
            guestUpgrading={guestUpgrading}
          />
        ) },

        // Accommodation (TR-07) — auto per stop; a manual extra line can still be added.
        { key: 'accommodation', label: 'Accommodation', node: (
          <>
          <p className="text-xs text-[var(--ecs-muted)] mb-2">{ac ? <>Editing this accommodation line{editTravellerLabel ? <> for <b>{editTravellerLabel}</b></> : null} — change the values and save.</> : <>A hotel line is <b>added automatically for each overnight stop</b> at the city&apos;s cap (editable rate, locked stay) and re-derives if you change the dates. Add a line below only for an extra/manual stay.</>}</p>
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
          <form action={ac ? updateAccommodation.bind(null, id, ac.id) : addAccommodation.bind(null, id)} className="space-y-3">
            <FormBar title={ac ? 'Edit this accommodation line — change the values and save.' : 'Add an extra / manual stay (hotel lines are otherwise auto-derived per stop).'}>
              {cancelLink}
              <button className="btn-primary">{ac ? 'Save accommodation changes' : 'Add accommodation estimate'}</button>
            </FormBar>
            <div className="grid grid-cols-2 gap-3">
              <AccommodationCityRate cities={cities.filter((c) => c.code !== 'SIN').map((c) => [c.code, c.name])} caps={capByCity} defaultCity={accRec?.city ?? tripDefaults.destCity} defaultRate={accRec ? String(accRec.quotedNightly) : undefined} />
              <Input name="nights" label="Nights" type="number" defaultValue={accRec ? String(accRec.nights) : tripDefaults.nights} />
              <Input name="personalNights" label="Personal nights" type="number" defaultValue={accRec ? String(accRec.personalNights) : '0'} />
              <Input name="checkIn" label="Check-in" type="date" defaultValue={accRec ? d(accRec.checkIn) : tripDefaults.start} />
              <Input name="checkOut" label="Check-out" type="date" defaultValue={accRec ? d(accRec.checkOut) : tripDefaults.end} />
            </div>
            <Input name="notes" label="Justification / note — explain here if the nightly rate is above the city cap (shown to the approver)" defaultValue={ac ? (ac.notes ?? '') : undefined} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="conferenceHotel" defaultChecked={accRec?.conferenceHotel ?? false} /> Conference hotel</label>
            {isGroup && !ac && <Select name="travellerId" label="Traveller" opts={gTravellers} />}
            {isGroup && ac && <div><label className="label">Traveller</label><div className="field bg-[var(--ecs-panel)] text-[var(--ecs-muted)]">{editTravellerLabel ?? '—'}</div></div>}
            {isGroup && !ac && <p className="text-xs text-[var(--ecs-muted)]">Each traveller books, pays and claims their own room — one line per traveller (choose All travellers to add for everyone).</p>}
            <p className="text-xs text-[var(--ecs-muted)]">The rate <b>defaults to the selected city&apos;s cap</b> and is editable; the estimate budgets at the <b>lower of the quoted rate and the cap</b> (a rate above the cap is capped and needs a justification). Caps — {hotelCaps.filter((h) => h.cityCode !== 'SIN').map((h) => `${h.cityCode} ${fmtSgd(h.capNightlySgd)}`).join(', ')}.</p>
          </form>
          </>
        ) },

        // Incidental (only when expense scope = ALL) — ODA is NOT a tab: it is derived automatically.
        ...(allowIncidental ? [{ key: 'other', label: 'Other / incidental', node: (
          <form action={ot ? updateOther.bind(null, id, ot.id) : addOther.bind(null, id)} className="space-y-3">
            <FormBar title={ot ? <>Editing this line{editTravellerLabel ? <> for <b>{editTravellerLabel}</b></> : null} — change the values and save.</> : 'Add an incidental / other cost (e.g. conference fee, ground transport).'}>
              {cancelLink}
              <button className="btn-primary">{ot ? 'Save changes' : 'Add incidental estimate'}</button>
            </FormBar>
            <div className="grid grid-cols-2 gap-3">
              <Select name="expenseTypeId" label="Expense type" defaultValue={ot?.expenseTypeId} opts={expenseTypes.filter((t) => !t.isMajorCost).map((t) => [t.id, t.name])} />
              <input type="hidden" name="currency" value="SGD" />
              <Input name="amount" label="Amount (SGD)" type="number" defaultValue={ot ? String(ot.foreignAmount) : undefined} />
              <Input name="notes" label="Note" defaultValue={ot ? (ot.notes ?? '') : undefined} />
              {isGroup && !ot && <Select name="travellerId" label="Traveller (if individual)" opts={gTravellers} />}
              {isGroup && !ot && <label className="flex items-center gap-2 text-sm pb-2"><input type="checkbox" name="shared" /> Shared — apportion</label>}
            </div>
          </form>
        ) }] : []),
      ]}>
        {req.expenses.length === 0
          ? <Empty>{emptyNote}</Empty>
          : <CostItems req={req} summary={summary} basis={settings.approvalAmountBasis} lineActions={lineActions} outcomeFor={outcomeFor} bare />}
      </EstimateCostAdd></div>
      ) : (
        req.expenses.length === 0
          ? <Card title={costTitle} className="mb-5"><Empty>{emptyNote}</Empty></Card>
          : <div className="mb-5"><CostItems req={req} summary={summary} basis={settings.approvalAmountBasis} outcomeFor={outcomeFor} /></div>
      )}

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
function RateCell({ id, e, canEdit }: { id: string; e: { id: string; autoDerived: boolean; notes: string | null; accommodation: { quotedNightly: number; capNightly: number; conferenceHotel: boolean } | null; oda: { dailyRate: number } | null }; canEdit: boolean }) {
  if (e.accommodation) {
    const over = e.accommodation.capNightly > 0 && e.accommodation.quotedNightly > e.accommodation.capNightly;
    if (e.autoDerived && canEdit) {
      // Rate edit + above-cap justification on a SINGLE line — justification takes the wider space
      // (left), the nightly-rate stepper and Set sit next to the line total on the right.
      return (
        <form action={updateAccommodationRate.bind(null, id, e.id)} className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-[var(--ecs-muted)]">$</span>
          <input name="quotedNightly" type="number" step="any" defaultValue={e.accommodation.quotedNightly} aria-label="Nightly rate" className="field !w-16 !py-1 !px-1.5 text-xs text-right" />
          <button className="btn-ghost text-xs" title="Update nightly rate">Set</button>
          {/* §4.5 above-cap justification OR conference-hotel declaration (self-justifying) — enforced on Set. */}
          <label className="flex items-center gap-1 text-[11px] text-[var(--ecs-muted)] whitespace-nowrap" title="A conference-venue hotel is self-justifying — no written justification needed"><input type="checkbox" name="conferenceHotel" defaultChecked={e.accommodation.conferenceHotel} /> Conf. hotel</label>
          <input name="justification" defaultValue={e.notes ?? ''} aria-label="Above-cap justification"
            placeholder={`Justification if > ${fmtSgd(e.accommodation.capNightly)} cap`}
            className={`field !py-1 !px-2 text-[11px] !w-[22rem] max-w-[55vw] ${over && !(e.notes ?? '').trim() && !e.accommodation.conferenceHotel ? '!border-[var(--ecs-red)]' : ''}`} />
        </form>
      );
    }
    return <span className="text-xs whitespace-nowrap">{fmtSgd(e.accommodation.quotedNightly)}<span className="text-[var(--ecs-muted)]">/n</span>{over && <span className="text-[var(--ecs-red)]" title="Above cap"> ⚠</span>}</span>;
  }
  if (e.oda) return <span className="text-xs whitespace-nowrap">{fmtSgd(e.oda.dailyRate)}<span className="text-[var(--ecs-muted)]">/day</span></span>;
  return <span className="text-xs text-[var(--ecs-muted)]">—</span>;
}
// Form header bar — the intro/caption on the left, the Save (+ Cancel) actions pinned to the
// top-right of the add/edit card, so the primary action sits at the top rather than full-width below.
function FormBar({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
      <p className="text-xs text-[var(--ecs-muted)] max-w-md">{title}</p>
      <div className="flex items-center gap-2 shrink-0 ml-auto">{children}</div>
    </div>
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

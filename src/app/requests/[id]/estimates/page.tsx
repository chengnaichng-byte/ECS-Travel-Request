// TR-05..08 Estimated Travel Costs — airfare, accommodation (with cap), ODA and
// permitted incidental costs. Reuses the TE expense pattern; receipt fields replaced
// by expected date, estimate basis and quotation (§4.4/§4.5).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadRequest } from '@/modules/pretrip/queries';
import { getSettings } from '@/modules/pretrip/settings';
import { currentPersonaId } from '@/shared/session';
import { canEditRequest } from '@/modules/pretrip/guards';
import { addAirfare, addAccommodation, addOther, deleteExpense, updateAccommodationRate, setHotelSettlement, updateClassJustification, updateAirfare, updateAccommodation, updateOther } from '@/modules/pretrip/actions';
import { EcsReference, EcsIdentity, EcsTravelClassRegister } from '@/shared/ecs/services';
import { effectiveLegs, sharedLegs as groupSharedLegs } from '@/modules/pretrip/group';
import { memberName, isGuestRequest, isNonEmployeeMember, isStudentMember } from '@/modules/pretrip/traveller';
type TagRef = { travellerType?: string | null; employeeId: string };
/** " · student" / " · guest" / "" — the non-employee label suffix for a member, with a chosen separator. */
const memberTag = (t: TagRef, sep: string) => isStudentMember(t) ? `${sep}student` : (isNonEmployeeMember(t) ? `${sep}guest` : '');
import { isTmcArrangement } from '@/modules/pretrip/booking';
import { provostsForSchool } from '@/modules/pretrip/provost';
import { AccommodationCityRate } from '@/components/AccommodationCityRate';
import { EstimateAddTabs } from '@/components/EstimateAddTabs';
import { AirfareForm } from '@/components/AirfareForm';
import { CostItems } from '@/components/ReviewSections';
import { computeSummary, fmtSgd } from '@/modules/pretrip/pricing';
import { cities, airports } from '@/data/locations';
import { travelClasses } from '@/data/travelClass';
import { hotelCaps } from '@/data/policyRates';
import { currencies } from '@/data/fxRates';
import { expenseTypes } from '@/data/expenseTypes';
import { EXPENSE_CATEGORY, POLICY_OUTCOME } from '@/shared/enums';
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
  // §13.19 Per-line policy outcome. A travel class above the derived entitlement is a policy
  // deviation (Exception) — mirror the policy engine so the airfare line shows it, not just the
  // Policy Review step. Accommodation above cap already carries its own exception outcome.
  const onDateForClass = req.startDate ?? new Date();
  const fallbackClassLegs = req.destCity ? [{ durationHours: EcsReference.flightHours(req.destCity), destCode: req.destCity, isPersonal: false }] : [];
  const entitledClassFor = (employeeId: string) => {
    const legs = isGroup
      ? (effectiveLegs(req, employeeId).length ? effectiveLegs(req, employeeId) : fallbackClassLegs)
      : (groupSharedLegs(req).length ? groupSharedLegs(req) : fallbackClassLegs);
    return EcsTravelClassRegister.entitledForItinerary(employeeId, legs, onDateForClass).classId;
  };
  const airfareOverClass = (e: (typeof req.expenses)[number]) => {
    if (e.category !== EXPENSE_CATEGORY.Airfare || !e.proposedClassId) return false;
    const employeeId = (isGroup ? e.travellerId : null) ?? req.travellerId;
    return EcsTravelClassRegister.rank(e.proposedClassId) > EcsTravelClassRegister.rank(entitledClassFor(employeeId));
  };
  // §13.19 the individual traveller's derived entitlement — the baseline the airfare form gates the
  // upgrade justification against (the stored entitledClassId is often null, so derive it live).
  const indivEntitledId = isGroup ? 'TC-ECO' : entitledClassFor(req.travellerId);
  const indivEntitledName = travelClasses.find((c) => c.id === indivEntitledId)?.name ?? 'Economy';

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
  const outcomeFor = (category: string, lines: (typeof req.expenses)) => {
    let excLines = 0;
    if (category === EXPENSE_CATEGORY.Airfare) excLines = lines.filter(airfareOverClass).length;
    else if (category === EXPENSE_CATEGORY.Accommodation) excLines = lines.filter((l) => l.accommodation?.exceptionOutcome === POLICY_OUTCOME.Exception).length;
    const exc = excLines > 0;
    return { exc, label: !exc ? 'Within Policy' : isGroup ? `${excLines} traveller${excLines > 1 ? 's' : ''} with Exception` : 'Exception' };
  };
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
  const cancelEdit = <Link href={`/requests/${id}/estimates`} className="btn-ghost w-full text-center">Cancel</Link>;
  const editLink = (eid: string) => `/requests/${id}/estimates?edit=${eid}#add-cost`;

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

      {/* Existing lines — the same expandable cost-items table as the Review step (Basis,
          Sponsorship/Personal, NTU-funded and a live Policy Outcome). Each row expands to the
          per-traveller computation; Edit / Remove and the auto hotel rate edit sit in that breakdown. */}
      {req.expenses.length === 0 ? (
        <Card title="Estimated Travel Costs" className="mb-5"><Empty>No estimate lines yet — ODA and a hotel line per stop are added automatically once the trip has a destination and dates (set them on the Trip step). Add airfare from your quote below.</Empty></Card>
      ) : (
        <div className="mb-5"><CostItems req={req} summary={summary} basis={settings.approvalAmountBasis} lineActions={lineActions} outcomeFor={outcomeFor} /></div>
      )}

      {canEdit && <div id="add-cost"><EstimateAddTabs
        defaultActive={editKind}
        hint="Select a cost type above to add it. ODA is derived automatically from the itinerary and appears in the summary above."
        tabs={[
        // Airfare (TR-06) — manual: a quoted fare, not policy-derived. A GROUP books each traveller at
        // their entitlement (class locked) → server form; an INDIVIDUAL/guest can pick a class, so it
        // uses the client AirfareForm which gates the Add button on the upgrade justification (§13.19).
        { key: 'airfare', label: 'Airfare', node: isGroup ? (
          <>
          <p className="text-xs text-[var(--ecs-muted)] mb-2">{af ? <>Editing this airfare line{editTravellerLabel ? <> for <b>{editTravellerLabel}</b></> : null} — change the values and save.</> : <>Airfare is a <b>quoted fare</b> (not policy-derived) — add it from your quote.</>}</p>
          <form action={af ? updateAirfare.bind(null, id, af.id) : addAirfare.bind(null, id)} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Select name="originCode" label="Origin" defaultValue={af?.originCode ?? tripDefaults.origin} opts={airports.map((a) => [a.code, a.code])} />
              <Select name="destCode" label="Destination" defaultValue={af?.destCode ?? tripDefaults.destAirport} opts={airports.filter((a) => a.cityCode !== 'SIN').map((a) => [a.code, a.code])} />
              <div><label className="label">Proposed class</label><div className="field bg-[var(--ecs-panel)] text-[var(--ecs-muted)] cursor-not-allowed">Per traveller — set to entitlement</div></div>
              <Input name="expectedDate" label="Expected date" type="date" defaultValue={af ? d(af.expectedDate) : tripDefaults.start} />
              <Select name="currency" label="Currency" defaultValue={af?.currency ?? 'SGD'} opts={currencies.map((c) => [c, c])} />
              <Input name="amount" label="Quoted amount" type="number" defaultValue={af ? String(af.foreignAmount) : undefined} />
              <Input name="sponsorship" label="Expected sponsorship" type="number" defaultValue={af ? String(af.sponsorForeign ?? 0) : undefined} />
              {!af && <Select name="travellerId" label="Traveller (individual)" opts={gTravellers} />}
              {af && <div><label className="label">Traveller</label><div className="field bg-[var(--ecs-panel)] text-[var(--ecs-muted)]">{editTravellerLabel ?? '—'}</div></div>}
            </div>
            <button className="btn-primary w-full">{af ? 'Save airfare changes' : 'Add airfare estimate'}</button>
            {af && cancelEdit}
          </form>
          </>
        ) : (
          <AirfareForm
            action={af ? updateAirfare.bind(null, id, af.id) : addAirfare.bind(null, id)}
            submitLabel={af ? 'Save airfare changes' : 'Add airfare estimate'}
            editing={!!af}
            cancel={af ? cancelEdit : undefined}
            originOpts={airports.map((a) => [a.code, a.code])}
            destOpts={airports.filter((a) => a.cityCode !== 'SIN').map((a) => [a.code, a.code])}
            classOpts={travelClasses.map((c) => [c.id, c.name])}
            classRanks={Object.fromEntries(travelClasses.map((c) => [c.id, c.rank]))}
            currencyOpts={currencies.map((c) => c)}
            defaults={{
              origin: af?.originCode ?? tripDefaults.origin,
              dest: af?.destCode ?? tripDefaults.destAirport,
              proposedClassId: af?.proposedClassId ?? (req.travelClassId || indivEntitledId),
              expectedDate: af ? d(af.expectedDate) : tripDefaults.start,
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
            <button className="btn-primary w-full">{ac ? 'Save accommodation changes' : 'Add accommodation estimate'}</button>
            {ac && cancelEdit}
          </form>
          </>
        ) },

        // Incidental (only when expense scope = ALL) — ODA is NOT a tab: it is derived automatically.
        ...(allowIncidental ? [{ key: 'other', label: 'Other / incidental', node: (
          <form action={ot ? updateOther.bind(null, id, ot.id) : addOther.bind(null, id)} className="space-y-3">
            {ot && <p className="text-xs text-[var(--ecs-muted)]">Editing this line{editTravellerLabel ? <> for <b>{editTravellerLabel}</b></> : null} — change the values and save.</p>}
            <div className="grid grid-cols-2 gap-3">
              <Select name="expenseTypeId" label="Expense type" defaultValue={ot?.expenseTypeId} opts={expenseTypes.filter((t) => !t.isMajorCost).map((t) => [t.id, t.name])} />
              <Select name="currency" label="Currency" defaultValue={ot?.currency ?? 'SGD'} opts={currencies.map((c) => [c, c])} />
              <Input name="amount" label="Amount" type="number" defaultValue={ot ? String(ot.foreignAmount) : undefined} />
              <Input name="notes" label="Note" defaultValue={ot ? (ot.notes ?? '') : undefined} />
              {isGroup && !ot && <Select name="travellerId" label="Traveller (if individual)" opts={gTravellers} />}
              {isGroup && !ot && <label className="flex items-center gap-2 text-sm pb-2"><input type="checkbox" name="shared" /> Shared — apportion</label>}
            </div>
            <button className="btn-primary w-full">{ot ? 'Save changes' : 'Add incidental estimate'}</button>
            {ot && cancelEdit}
          </form>
        ) }] : []),
      ]} /></div>}

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

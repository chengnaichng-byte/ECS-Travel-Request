// TR-04 Trip Details — purpose, justification, dates, itinerary, travel class and
// proposed booking method (§4.4 replaces the retrospective TRS checkbox).
import { notFound } from 'next/navigation';
import { loadRequest } from '@/modules/pretrip/queries';
import { currentPersonaId } from '@/shared/session';
import { canEditRequest } from '@/modules/pretrip/guards';
import { saveTrip, attachNamedFile, removeNamedAttachment, saveTravellerItinerary, saveTravellerPersonal } from '@/modules/pretrip/actions';
import { getSettings } from '@/modules/pretrip/settings';
import { memberName, isGuestMember, hasNonEmployeeTraveller } from '@/modules/pretrip/traveller';
import { GroupPersonalDays } from '@/components/GroupPersonalDays';
import { sharedLegs } from '@/modules/pretrip/group';
import { PerTravellerItineraries } from '@/components/PerTravellerItineraries';
import { NON_TERM_APPROVAL_DOC, nonTermResearchEligible } from '@/modules/pretrip/nonTerm';
import { listAcademicTerms, deriveNonTermTime } from '@/modules/pretrip/academicCalendar';
import { NonTermField } from '@/components/NonTermField';
import Link from 'next/link';
import { travelPurposes } from '@/data/travelPurposes';
import { parsePersonalPeriods } from '@/modules/pretrip/personal';
import { listTmcProviders } from '@/modules/pretrip/tmcConfig';
import { airports, cities, countries } from '@/data/locations';
import { TMC_BOOKING_METHODS, NON_TMC_ARRANGEMENTS, BOOKING_METHOD } from '@/shared/enums';
import { BookingFields } from '@/components/BookingFields';
import { TripPlanner } from '@/components/TripPlanner';
import { isTmcArrangement } from '@/modules/pretrip/booking';
import { resolveTmcProvider } from '@/modules/pretrip/tmcRouting';
import { Card, CollapsibleCard, Stepper } from '@/components/ui';
import { ProvenanceLegend } from '@/components/ProvenanceLegend';
import { findTravellerConflicts } from '@/modules/pretrip/duplicates';

export const dynamic = 'force-dynamic';

function d(v: Date | null) { return v ? v.toISOString().slice(0, 10) : ''; }

export default async function TripStep({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const { error } = await searchParams;
  const req = await loadRequest(id);
  if (!req) notFound();
  const canEdit = canEditRequest(await currentPersonaId(), req);

  // §10 event dates show only for a conference purpose; §4.5 personal days are declared, seeded from the
  // legacy personalStart/End window for any pre-existing request that has no declared periods yet.
  const conferencePurposeIds = travelPurposes.filter((p) => p.isConference).map((p) => p.id);
  const initialPersonalPeriods = (() => {
    const parsed = parsePersonalPeriods(req.personalPeriodsJson);
    if (parsed.length) return parsed;
    if (req.personalStart && req.personalEnd) return [{ start: d(req.personalStart), end: d(req.personalEnd) }];
    return [];
  })();

  const sortedLegs = req.legs.filter((l) => !l.travellerId).sort((a, b) => a.seq - b.seq);
  // §2.2 resolved TMC for the current booking arrangement (shown read-only in the trip section).
  const tmcProviderOpts = (await listTmcProviders()).filter((p) => p.active).map((p) => ({ id: p.id, name: p.name }));
  const tmcText = isTmcArrangement(req.bookingArrangement) ? (await resolveTmcProvider(req)).provider.name : 'Not via a TMC';
  const tripType = (req.tripType === 'ONE_WAY' || req.tripType === 'MULTI_CITY' ? req.tripType : 'ROUND_TRIP') as 'ROUND_TRIP' | 'ONE_WAY' | 'MULTI_CITY';
  // §4.4 Arrive defaults to Depart (same-day) when blank — nearly every single flight lands the same
  // calendar day; editable for the odd red-eye. (saveTrip persists this too.)
  const initialLegs = sortedLegs.map((l) => ({ originCode: l.originCode, destCode: l.destCode, departDate: d(l.departDate), arriveDate: d(l.arriveDate) || d(l.departDate), nights: l.nights, durationHours: l.durationHours != null ? String(l.durationHours) : '', isPersonal: l.isPersonal }));
  // airport → city/country names, so the leg builder can show the derived main destination.
  const airportMeta: Record<string, { city: string; country: string; cityCode: string; countryCode: string }> = {};
  for (const a of airports) {
    const city = cities.find((c) => c.code === a.cityCode);
    const country = city ? countries.find((c) => c.code === city.countryCode) : undefined;
    airportMeta[a.code] = { city: city?.name ?? a.cityCode, country: country?.name ?? '', cityCode: a.cityCode, countryCode: city?.countryCode ?? '' };
  }
  // §13.x live duplicate/overlap candidates — other live requests sharing a traveller; the Trip
  // step intersects them against the itinerary being entered (see TripPlanner's validation panel).
  const conflicts = await findTravellerConflicts(req);
  // §13.x Non-term research — availability gated on the research funding (Is-Research flag).
  const nonTermEligible = nonTermResearchEligible(req);
  const nonTermApprovals = req.attachments.filter((a) => a.docType === NON_TERM_APPROVAL_DOC);
  // §13.x Non-term research is DERIVED from the teaching calendar for the current travel window.
  const nonTermDerivation = nonTermEligible ? deriveNonTermTime(req.startDate, req.endDate, await listAcademicTerms()) : null;
  // §13.20 Per-traveller group itineraries — shown for a group when the setting is on. Each traveller's
  // own legs (a declared deviation) are editable; non-deviating travellers follow the shared itinerary.
  const settings = await getSettings();
  const perTravellerOn = !!settings.groupSubItineraries && req.isGroup;
  const airportOpts: [string, string][] = airports.map((a) => [a.code, `${a.code} · ${airportMeta[a.code]?.city ?? a.code}`]);
  const sharedLegList = sharedLegs(req);
  const sharedRoute = sharedLegList.length ? [sharedLegList[0].originCode, ...sharedLegList.map((l) => l.destCode)].join(' → ') : '';
  const itineraryMembers = perTravellerOn ? req.travellers.map((t) => ({
    employeeId: t.employeeId,
    name: memberName(t),
    legs: req.legs.filter((l) => l.travellerId === t.employeeId).sort((a, b) => a.seq - b.seq)
      .map((l) => ({ originCode: l.originCode, destCode: l.destCode, departDate: d(l.departDate), arriveDate: d(l.arriveDate) || d(l.departDate), isPersonal: l.isPersonal })),
    airfareEstimateSgd: t.airfareEstimateSgd,
    action: saveTravellerItinerary.bind(null, id, t.employeeId),
  })) : [];

  // §13.20 A traveller with their OWN legs is a declared deviation from the shared itinerary. The
  // TMS cannot book a GROUP online when travellers fly different routes/dates, so an online method is
  // switched to agent-assisted on save (enforced in saveTrip / saveTravellerItinerary); surface it here.
  const deviationCount = itineraryMembers.filter((m) => m.legs.length > 0).length;
  const anyDeviation = deviationCount > 0;
  const methodOnline = req.bookingMethod === BOOKING_METHOD.TMCOnline;

  // §2.2 Guest and student travellers have no SSO sign-in to the online booking tool, so their trips
  // cannot be self-booked online — hide "TMC online" and book agent-assisted (enforced in saveTrip).
  const nonEmployeeTraveller = hasNonEmployeeTraveller(req);
  const bookingMethods = nonEmployeeTraveller
    ? TMC_BOOKING_METHODS.filter((m) => m.value !== BOOKING_METHOD.TMCOnline)
    : TMC_BOOKING_METHODS;
  // For a guest/student trip whose stored method is online (now unavailable) or unset, pre-select
  // agent-assisted so the field shows a valid choice rather than falling back to "Select…".
  const initialMethod = nonEmployeeTraveller && (req.bookingMethod === BOOKING_METHOD.TMCOnline || !req.bookingMethod)
    ? BOOKING_METHOD.AgentAssisted
    : (req.bookingMethod ?? '');

  const purposeCard = (
    <Card title="Trip Purpose & Justification">
      <div className="grid md:grid-cols-3 gap-4">
        <div>
          <label className="label">Travel purpose</label>
          <select name="purposeId" defaultValue={req.purposeId ?? ''} className="field" required>
            <option value="">Select…</option>
            {travelPurposes.filter((p) => p.active || p.id === req.purposeId).map((p) => <option key={p.id} value={p.id}>{p.name}{p.isResearch ? ' (research)' : ''}</option>)}
          </select>
        </div>
        <BookingFields
          providers={tmcProviderOpts}
          nonTmc={NON_TMC_ARRANGEMENTS}
          methods={bookingMethods}
          initialArrangement={req.bookingArrangement ?? 'AUTO'}
          initialMethod={initialMethod}
          methodHint={nonEmployeeTraveller ? 'Guest and student travellers have no SSO sign-in to the online booking tool, so these trips are booked agent-assisted (or offline).' : undefined}
        />
        <div className="md:col-span-3">
          <label className="label">TMC (resolved)</label>
          <div className="field bg-[var(--ecs-panel)] text-[var(--ecs-muted)]">{tmcText}<span className="ml-1 text-xs">· derived from the booking arrangement on save (§2.2)</span></div>
        </div>
        <div className="md:col-span-3">
          <label className="label">Description / justification</label>
          <textarea name="description" defaultValue={req.description ?? ''} rows={2} className="field" placeholder="e.g. Presenting a paper at IEEE conference" />
        </div>
        <div className="md:col-span-3">
          <label className="label">Invitation / acceptance reference</label>
          <input name="invitationRef" defaultValue={req.invitationRef ?? ''} className="field" placeholder="e.g. IEEE-2027-ACCEPT-4821" />
        </div>
        <div className="md:col-span-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="visaLetterRequired" defaultChecked={req.visaLetterRequired} className="w-4 h-4" />
            <span>A <strong>letter from HR</strong> is required for Visa application (§4.13).</span>
          </label>
        </div>
        {/* §13.x Non-term research — a research-gated attestation checkbox, below the visa-letter row. */}
        <NonTermField eligible={nonTermEligible} declared={req.nonTermDeclared} derivation={nonTermDerivation} approvals={nonTermApprovals} attachAction={attachNamedFile.bind(null, id, 'nonTermEmail', NON_TERM_APPROVAL_DOC)} removeAction={removeNamedAttachment.bind(null, id)} />
      </div>
    </Card>
  );

  // §13.20 Rendered by TripPlanner AFTER the trip form (outside it, so the per-traveller rows' own
  // forms aren't nested) and BEFORE the Save buttons. Collapsed by default; the differing-itinerary
  // booking-method notice sits above it so it stays visible while the card is closed.
  // §4.5 Per-traveller personal days — EVERY group (independent of the sub-itinerary toggle); staff and
  // student members declare, guests do not. Each member's window is their own dates when they deviate.
  const personalMembers = req.isGroup ? req.travellers.filter((t) => !isGuestMember(t)) : [];
  const personalDeclaredCount = personalMembers.filter((t) => (parsePersonalPeriods(t.personalPeriodsJson)).length > 0).length;
  const perTravellerCard = req.isGroup ? (
    <div className="mt-5 space-y-3">
      {perTravellerOn && anyDeviation && methodOnline && (
        <div className="card p-3 text-sm text-amber-900 bg-amber-50 border-amber-200">
          <b>Booking method will change to TMC agent-assisted.</b> {deviationCount} traveller{deviationCount > 1 ? 's have' : ' has'} a different itinerary. The TMS cannot book a group <b>online</b> when travellers fly different routes or dates, so on save the booking method changes from <b>TMC online</b> to <b>TMC agent-assisted</b> (§13.20).
        </div>
      )}
      {perTravellerOn && anyDeviation && req.bookingMethod === BOOKING_METHOD.AgentAssisted && (
        <div className="card p-3 text-sm text-[var(--ecs-muted)] bg-[var(--ecs-panel)] border-[var(--ecs-border)]">
          Travellers fly different itineraries, so this group is booked <b>TMC agent-assisted</b> — the TMS cannot book a group online when itineraries differ (§13.20).
        </div>
      )}
      {perTravellerOn && itineraryMembers.length > 0 && (
        <CollapsibleCard
          title="Per-traveller itineraries (§13.20)"
          defaultOpen={false}
          stub={anyDeviation ? `${deviationCount} on own itinerary` : 'All follow the shared itinerary'}
        >
          <PerTravellerItineraries members={itineraryMembers} airports={airportOpts} sharedRoute={sharedRoute} />
        </CollapsibleCard>
      )}
      {personalMembers.length > 0 && (
        <CollapsibleCard
          title="Per-traveller personal days (§4.5)"
          defaultOpen={false}
          stub={personalDeclaredCount > 0 ? `${personalDeclaredCount} with personal days` : 'All official business'}
        >
          <p className="text-sm text-[var(--ecs-muted)] mb-3">Select a traveller to declare their own personal days (before, during or after the business portion). Personal days are excluded from that member&apos;s ODA and personal nights from the accommodation budget. Guests do not declare.</p>
          <GroupPersonalDays
            disabled={!canEdit}
            members={personalMembers.map((t) => ({
              employeeId: t.employeeId,
              name: memberName(t),
              tripStart: d(t.ownStartDate ?? req.startDate),
              tripEnd: d(t.ownEndDate ?? req.endDate),
              initial: parsePersonalPeriods(t.personalPeriodsJson),
              action: saveTravellerPersonal.bind(null, id, t.employeeId),
            }))}
          />
        </CollapsibleCard>
      )}
    </div>
  ) : null;

  return (
    <div>
      <Stepper id={id} active="trip" requestNumber={req.requestNumber} status={req.status} />
      {error && <div className="card p-3 mb-4 text-sm text-red-800 bg-red-50 border-red-200">{error}</div>}
      {!canEdit &&<div className="card p-3 mb-4 text-sm text-amber-900 bg-amber-50 border-amber-200">Read-only view — your role cannot edit this request&apos;s trip details.</div>}
      <ProvenanceLegend className="mb-4" />
      <TripPlanner
        action={saveTrip.bind(null, id)}
        header={purposeCard}
        perTravellerCard={perTravellerCard}
        initialAirfareSgd={req.airfareEstimateSgd != null ? String(req.airfareEstimateSgd) : ''}
        isGroup={req.isGroup}
        airports={airports.map((a) => ({ code: a.code, name: a.name }))}
        airportMeta={airportMeta}
        initialTripType={tripType}
        initialLegs={initialLegs}
        initialStart={d(req.startDate)}
        initialEnd={d(req.endDate)}
        initialEventStart={d(req.eventStartDate)}
        initialEventEnd={d(req.eventEndDate)}
        initialPersonalPeriods={initialPersonalPeriods}
        initialPurposeId={req.purposeId ?? ''}
        conferencePurposeIds={conferencePurposeIds}
        continueHref={`/requests/${id}/estimates`}
        disabled={!canEdit}
        conflicts={conflicts}
      />
    </div>
  );
}

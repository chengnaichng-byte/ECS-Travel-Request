// TR-04 Trip Details — purpose, justification, dates, itinerary, travel class and
// proposed booking method (§4.4 replaces the retrospective TRS checkbox).
import { notFound } from 'next/navigation';
import { loadRequest } from '@/modules/pretrip/queries';
import { currentPersonaId } from '@/shared/session';
import { canEditRequest } from '@/modules/pretrip/guards';
import { saveTrip, addAttachment, attachNamedFile } from '@/modules/pretrip/actions';
import { getSettings } from '@/modules/pretrip/settings';
import { EMERGENCY_APPROVAL_DOC, emergencyMethodAllowed, withinEmergencyWindow, leadTimeDays, EMERGENCY_OOW_MIN_JUSTIFICATION } from '@/modules/pretrip/emergency';
import { NON_TERM_APPROVAL_DOC, nonTermResearchEligible } from '@/modules/pretrip/nonTerm';
import { bookingSummaryText } from '@/modules/pretrip/booking';
import { employees } from '@/data/employees';
import Link from 'next/link';
import { travelPurposes } from '@/data/travelPurposes';
import { activeProviders } from '@/data/tmcProviders';
import { airports, cities, countries } from '@/data/locations';
import { TMC_BOOKING_METHODS, NON_TMC_ARRANGEMENTS } from '@/shared/enums';
import { BookingFields } from '@/components/BookingFields';
import { TripPlanner } from '@/components/TripPlanner';
import { isTmcArrangement } from '@/modules/pretrip/booking';
import { resolveTmcProvider } from '@/modules/pretrip/tmcRouting';
import { Card, Stepper } from '@/components/ui';
import { findTravellerConflicts } from '@/modules/pretrip/duplicates';

export const dynamic = 'force-dynamic';

function d(v: Date | null) { return v ? v.toISOString().slice(0, 10) : ''; }

export default async function TripStep({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const { error } = await searchParams;
  const req = await loadRequest(id);
  if (!req) notFound();
  const canEdit = canEditRequest(await currentPersonaId(), req);

  const sortedLegs = req.legs.filter((l) => !l.travellerId).sort((a, b) => a.seq - b.seq);
  // §2.2 resolved TMC for the current booking arrangement (shown read-only in the trip section).
  const tmcText = isTmcArrangement(req.bookingArrangement) ? resolveTmcProvider(req).provider.name : 'Not via a TMC';
  const tripType = (req.tripType === 'ONE_WAY' || req.tripType === 'MULTI_CITY' ? req.tripType : 'ROUND_TRIP') as 'ROUND_TRIP' | 'ONE_WAY' | 'MULTI_CITY';
  const initialLegs = sortedLegs.map((l) => ({ originCode: l.originCode, destCode: l.destCode, departDate: d(l.departDate), arriveDate: d(l.arriveDate), nights: l.nights, durationHours: l.durationHours != null ? String(l.durationHours) : '', isPersonal: l.isPersonal }));
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
  const settings = await getSettings();
  // §13.x / DD-23 Emergency lane — availability gated on the saved booking method; the fields are
  // declared here and carried into submission.
  const emergencyMethodOk = emergencyMethodAllowed(req);
  const emergencyAuthorisers = employees.filter((e) => !e.isTraveller && e.travelPolicyGroup === 'SENIOR' && e.id !== req.travellerId);
  const emergencyApprovals = req.attachments.filter((a) => a.docType === EMERGENCY_APPROVAL_DOC);
  const emergencyOutsideWindow = !withinEmergencyWindow(req, settings.emergencyLeadDays);
  const emergencyLeadDays = leadTimeDays(req);
  // §13.x Non-term research — availability gated on the research funding (Is-Research flag).
  const nonTermEligible = nonTermResearchEligible(req);
  const nonTermApprovals = req.attachments.filter((a) => a.docType === NON_TERM_APPROVAL_DOC);

  return (
    <div>
      <Stepper id={id} active="trip" requestNumber={req.requestNumber} status={req.status} />
      {error && <div className="card p-3 mb-4 text-sm text-red-800 bg-red-50 border-red-200">{error}</div>}
      {!canEdit &&<div className="card p-3 mb-4 text-sm text-amber-900 bg-amber-50 border-amber-200">Read-only view — your role cannot edit this request&apos;s trip details.</div>}
      <form action={saveTrip.bind(null, id)} className="space-y-5">
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
              providers={activeProviders().map((p) => ({ id: p.id, name: p.name }))}
              nonTmc={NON_TMC_ARRANGEMENTS}
              methods={TMC_BOOKING_METHODS}
              initialArrangement={req.bookingArrangement ?? 'AUTO'}
              initialMethod={req.bookingMethod ?? ''}
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
                <span>A <strong>visa letter</strong> is required for this trip (§4.13) — the immigration office is notified once the request is approved.</span>
              </label>
            </div>
          </div>
        </Card>

        <TripPlanner
          airports={airports.map((a) => ({ code: a.code, name: a.name }))}
          airportMeta={airportMeta}
          initialTripType={tripType}
          initialLegs={initialLegs}
          initialStart={d(req.startDate)}
          initialEnd={d(req.endDate)}
          initialEventStart={d(req.eventStartDate)}
          initialEventEnd={d(req.eventEndDate)}
          initialPersonalStart={d(req.personalStart)}
          initialPersonalEnd={d(req.personalEnd)}
          continueHref={`/requests/${id}/estimates`}
          disabled={!canEdit}
          conflicts={conflicts}
        />

        {/* §13.x / DD-23 Emergency lane (book first, raise later) — declared here; availability follows
            the SAVED booking method (set an agent-assisted / offline method above, then save). */}
        <details className="group card p-0 overflow-hidden" open={req.isEmergency}>
          <summary className="px-4 py-3 cursor-pointer select-none flex items-center gap-2 font-semibold text-[var(--ecs-navy)] list-none">
            <span className="transition-transform group-open:rotate-90">▸</span> Emergency lane — book first, raise later (DD-23)
            {req.isEmergency
              ? <span className="pill-exc ml-1">In use</span>
              : emergencyMethodOk
                ? <span className="ml-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#e8f3ec] text-[#2f7d4f]">Available</span>
                : <span className="ml-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-[var(--ecs-panel)] text-[var(--ecs-muted)] border border-[var(--ecs-border)]">Not available · needs agent-assisted / offline booking</span>}
            {req.isEmergency && req.emergencyOutsideWindow && <span className="pill-warn ml-1">Outside standard window</span>}
          </summary>
          <div className="px-4 pb-4 space-y-3 border-t border-[var(--ecs-border)] pt-3">
            <p className="text-xs text-[var(--ecs-muted)]">A bounded, audited lane for urgent travel — <strong>book first, raise/approve later</strong>. The trip can be booked (or already booked) before approval on a named officer&apos;s authority, but the <strong>full approval workflow still runs, retrospectively</strong>. Requires a justification, a named authorising officer and the authorising e-mail; available only for TMC agent-assisted / offline bookings.</p>
            {!emergencyMethodOk ? (
              <div className="text-sm rounded border border-[#f59e0b] bg-[#fff8ec] p-3">
                <strong>Emergency lane unavailable for this booking method.</strong> The current booking is <em>{bookingSummaryText(req.bookingArrangement, req.bookingMethod)}</em>. The book-first lane needs a human agent to hold or place the booking ahead of approval, so it is offered only for <strong>TMC agent-assisted</strong> or <strong>offline</strong> bookings. Set an agent-assisted / offline booking method above and <strong>save</strong> this step to enable it.
              </div>
            ) : (
              <>
                {emergencyOutsideWindow && (
                  <div className="text-sm rounded border border-[#f97316] bg-[#fff3e8] p-3">
                    <strong>Outside the standard {settings.emergencyLeadDays}-day window.</strong> The earliest departure is about <strong>{emergencyLeadDays ?? '—'} day(s)</strong> away. You may still use the emergency lane, but a <strong>detailed justification</strong> (at least {EMERGENCY_OOW_MIN_JUSTIFICATION} characters) and the confirmation below are required.
                  </div>
                )}
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="emergency" value="on" defaultChecked={req.isEmergency} className="mt-0.5 w-4 h-4" />
                  <span>Use the <strong>emergency lane</strong> (book first, raise later) for this request.</span>
                </label>
                <div className="pl-6">
                  <label className="label">Authorising officer (records who authorised the emergency)</label>
                  <select name="emergencyAuthoriserId" defaultValue={req.emergencyAuthoriserId ?? ''} className="field w-96 max-w-full">
                    <option value="">— select an authorising officer —</option>
                    {emergencyAuthorisers.map((e) => <option key={e.id} value={e.id}>{e.name} · {e.title}</option>)}
                  </select>
                </div>
                <div className="pl-6">
                  <label className="label">Emergency justification{emergencyOutsideWindow && <span className="text-[var(--ecs-red)]"> * (detailed — at least {EMERGENCY_OOW_MIN_JUSTIFICATION} characters)</span>}</label>
                  <textarea name="emergencyJustification" defaultValue={req.emergencyJustification ?? ''} rows={emergencyOutsideWindow ? 3 : 2} className="field w-full" placeholder="e.g. same-day flight to an urgent funder meeting; TMC held space pending authorisation." />
                </div>
                {emergencyOutsideWindow && (
                  <label className="pl-6 flex items-start gap-2 text-sm">
                    <input type="checkbox" name="emergencyOutOfWindowAck" value="on" defaultChecked={req.emergencyOutsideWindow} className="mt-0.5 w-4 h-4" />
                    <span>I confirm this is a genuine emergency despite the {emergencyLeadDays ?? '—'}-day lead time, and the standard lane is not feasible.</span>
                  </label>
                )}
                {/* Mandatory email-approval attachment — uses the request's attachment store via a button
                    formAction (overrides the Trip form's saveTrip action for this click). */}
                <div className="pl-6">
                  <label className="label">Email approval <span className="text-[var(--ecs-red)]">*</span> — attach the authorising officer&apos;s e-mail (PDF/PNG/JPEG)</label>
                  {emergencyApprovals.length > 0 ? (
                    <ul className="text-xs mb-1 space-y-0.5">
                      {emergencyApprovals.map((a) => <li key={a.id} className="flex items-center gap-2"><span className="pill-pass">Attached</span> {a.fileName} <span className="text-[var(--ecs-muted)]">({a.sizeKb} KB)</span></li>)}
                    </ul>
                  ) : (
                    <p className="text-xs text-[var(--ecs-red)] mb-1">Required for the emergency lane — attach the authorising e-mail.</p>
                  )}
                  <div className="flex items-center gap-2">
                    <input type="file" name="file" accept="application/pdf,image/png,image/jpeg" className="text-xs" />
                    <input type="hidden" name="docType" value={EMERGENCY_APPROVAL_DOC} />
                    <button formAction={addAttachment.bind(null, id)} className="btn-secondary text-xs">Attach email approval</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </details>

        {/* §13.x Non-term research travel — offline-approval attestation (research-funded travel only). */}
        <details className="group card p-0 overflow-hidden" open={req.nonTermDeclared || nonTermEligible}>
          <summary className="px-4 py-3 cursor-pointer select-none flex items-center gap-2 font-semibold text-[var(--ecs-navy)] list-none">
            <span className="transition-transform group-open:rotate-90">▸</span> Non-term research travel — offline approval
            {req.nonTermDeclared
              ? <span className="pill-exc ml-1">Attested</span>
              : nonTermEligible
                ? <span className="ml-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#e8f3ec] text-[#2f7d4f]">Available</span>
                : <span className="ml-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-[var(--ecs-panel)] text-[var(--ecs-muted)] border border-[var(--ecs-border)]">Not available · research-funded travel only</span>}
          </summary>
          <div className="px-4 pb-4 space-y-3 border-t border-[var(--ecs-border)] pt-3">
            <p className="text-xs text-[var(--ecs-muted)]">When a <strong>research-funded</strong> trip takes place in <strong>non-term time</strong>, the required approval has already been obtained offline. Attest below and attach the approval e-mail; where enabled in the workflow configuration, this fast-tracks the pre-trip approval. Available only for research-funded travel (the Is-Research flag follows the charging account — set it on the Charging step).</p>
            {!nonTermEligible ? (
              <div className="text-sm rounded border border-[var(--ecs-border)] bg-[var(--ecs-panel)] p-3 text-[var(--ecs-muted)]">
                <strong className="text-[var(--ecs-text)]">Available for research-funded travel only.</strong> This trip is not research-funded (your default charging account is not a research WBS). Charge it to a research cost object on the <Link href={`/requests/${id}/charging`} className="underline">Charging step</Link> to use this.
              </div>
            ) : (
              <>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="nonTerm" value="on" defaultChecked={req.nonTermDeclared} className="mt-0.5 w-4 h-4" />
                  <span>This trip is in <strong>non-term time</strong> and the required <strong>offline approval has already been obtained</strong>.</span>
                </label>
                <div className="pl-6">
                  <label className="label">Offline approval e-mail <span className="text-[var(--ecs-red)]">*</span> — attach the approving e-mail (PDF/PNG/JPEG)</label>
                  {nonTermApprovals.length > 0 ? (
                    <ul className="text-xs mb-1 space-y-0.5">
                      {nonTermApprovals.map((a) => <li key={a.id} className="flex items-center gap-2"><span className="pill-pass">Attached</span> {a.fileName} <span className="text-[var(--ecs-muted)]">({a.sizeKb} KB)</span></li>)}
                    </ul>
                  ) : (
                    <p className="text-xs text-[var(--ecs-muted)] mb-1">Attach the approval e-mail that supports this attestation.</p>
                  )}
                  <div className="flex items-center gap-2">
                    <input type="file" name="nonTermEmail" accept="application/pdf,image/png,image/jpeg" className="text-xs" />
                    <button formAction={attachNamedFile.bind(null, id, 'nonTermEmail', NON_TERM_APPROVAL_DOC)} className="btn-secondary text-xs">Attach approval e-mail</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </details>
      </form>
    </div>
  );
}

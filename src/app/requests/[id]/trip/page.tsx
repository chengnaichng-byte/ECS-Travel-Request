// TR-04 Trip Details — purpose, justification, dates, itinerary, travel class and
// proposed booking method (§4.4 replaces the retrospective TRS checkbox).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadRequest } from '@/modules/pretrip/queries';
import { currentPersonaId } from '@/shared/session';
import { canEditRequest } from '@/modules/pretrip/guards';
import { saveTrip } from '@/modules/pretrip/actions';
import { travelPurposes } from '@/data/travelPurposes';
import { activeProviders } from '@/data/tmcProviders';
import { countries, cities, airports } from '@/data/locations';
import { travelClasses } from '@/data/travelClass';
import { TMC_BOOKING_METHODS, NON_TMC_ARRANGEMENTS } from '@/shared/enums';
import { BookingFields } from '@/components/BookingFields';
import { TripItinerary } from '@/components/TripItinerary';
import { EcsReference, EcsTravelClassRegister } from '@/shared/ecs/services';
import { Card, Stepper } from '@/components/ui';

export const dynamic = 'force-dynamic';

function d(v: Date | null) { return v ? v.toISOString().slice(0, 10) : ''; }

export default async function TripStep({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const { error } = await searchParams;
  const req = await loadRequest(id);
  if (!req) notFound();
  const canEdit = canEditRequest(await currentPersonaId(), req);

  // §13.19 entitlement pre-fill for the (single-destination) trip.
  const onDate = req.startDate ?? new Date();
  const hours = req.destCity ? EcsReference.flightHours(req.destCity) : 12;
  const derived = req.destCity
    ? EcsTravelClassRegister.entitledForItinerary(req.travellerId, [{ durationHours: hours, destCode: req.destCity }], onDate)
    : null;
  const entitledId = req.entitledClassId ?? derived?.classId ?? 'TC-ECO';
  const basis = req.classBasis ?? derived?.basis ?? 'Select a destination to derive the entitlement';
  const prefillClass = req.travelClassId ?? entitledId;
  const entitledName = travelClasses.find((c) => c.id === entitledId)?.name ?? 'Economy';
  const sortedLegs = req.legs.filter((l) => !l.travellerId).sort((a, b) => a.seq - b.seq);
  const tripType = (req.tripType === 'ONE_WAY' || req.tripType === 'MULTI_CITY' ? req.tripType : 'ROUND_TRIP') as 'ROUND_TRIP' | 'ONE_WAY' | 'MULTI_CITY';
  const initialOrigin = sortedLegs[0]?.originCode ?? 'SIN';
  const initialDestAirport = sortedLegs.find((l) => l.destCode !== 'SIN')?.destCode ?? '';
  const initialLegs = sortedLegs.map((l) => ({ originCode: l.originCode, destCode: l.destCode, departDate: d(l.departDate), arriveDate: d(l.arriveDate), nights: l.nights, durationHours: l.durationHours != null ? String(l.durationHours) : '', isPersonal: l.isPersonal }));

  return (
    <div>
      <Stepper id={id} active="trip" />
      {error && <div className="card p-3 mb-4 text-sm text-red-800 bg-red-50 border-red-200">{error}</div>}
      {!canEdit && <div className="card p-3 mb-4 text-sm text-amber-900 bg-amber-50 border-amber-200">Read-only view — your role cannot edit this request&apos;s trip details.</div>}
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
              <label className="label">Description / justification</label>
              <textarea name="description" defaultValue={req.description ?? ''} rows={2} className="field" placeholder="e.g. Presenting a paper at IEEE conference" />
            </div>
            <div>
              <label className="label">Event start (§10)</label>
              <input type="date" name="eventStartDate" defaultValue={d(req.eventStartDate)} className="field" />
            </div>
            <div>
              <label className="label">Event end</label>
              <input type="date" name="eventEndDate" defaultValue={d(req.eventEndDate)} className="field" />
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

        <Card title="Destination & Itinerary">
          <TripItinerary
            airports={airports.map((a) => ({ code: a.code, name: a.name }))}
            countries={countries.map((c) => ({ code: c.code, name: c.name }))}
            cities={cities.filter((c) => c.code !== 'SIN').map((c) => ({ code: c.code, name: c.name }))}
            initialTripType={tripType}
            initialOrigin={initialOrigin}
            initialDestCountry={req.destCountry ?? ''}
            initialDestCity={req.destCity ?? ''}
            initialDestAirport={initialDestAirport}
            initialLegs={initialLegs}
            disabled={!canEdit}
          />
          <div className="grid md:grid-cols-3 gap-4 mt-4 border-t border-[var(--ecs-border)] pt-4">
            <div>
              <label className="label">Travel class</label>
              <select name="travelClassId" defaultValue={prefillClass} disabled={!canEdit} className="field">
                {travelClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <p className="text-xs text-[var(--ecs-muted)] mt-1">Entitled: <strong>{entitledName}</strong> · <span className="italic">{basis}</span> (§13.19)</p>
            </div>
            <div className="md:col-span-2">
              <label className="label">Justification for higher class (required if above entitlement — §13.19)</label>
              <textarea name="classJustification" defaultValue={req.classJustification ?? ''} rows={2} disabled={!canEdit} className="field" placeholder="e.g. medical accommodation, red-eye connection…" />
            </div>
          </div>
        </Card>

        <Card title="Dates">
          <div className="grid md:grid-cols-4 gap-4">
            <div>
              <label className="label">Official start</label>
              <input type="date" name="startDate" defaultValue={d(req.startDate)} className="field" required />
            </div>
            <div>
              <label className="label">Official end</label>
              <input type="date" name="endDate" defaultValue={d(req.endDate)} className="field" required />
            </div>
            <div>
              <label className="label">Personal extension start</label>
              <input type="date" name="personalStart" defaultValue={d(req.personalStart)} className="field" />
            </div>
            <div>
              <label className="label">Personal extension end</label>
              <input type="date" name="personalEnd" defaultValue={d(req.personalEnd)} className="field" />
            </div>
          </div>
          <p className="text-xs text-[var(--ecs-muted)] mt-2">Personal days are excluded from ODA and personal nights from the accommodation budget (§4.5, AC18).</p>
        </Card>

        <div className="flex justify-end gap-2">
          {canEdit
            ? <button type="submit" className="btn-primary">Save trip &amp; continue →</button>
            : <Link href={`/requests/${id}/estimates`} className="btn-primary">Continue →</Link>}
        </div>
      </form>
    </div>
  );
}

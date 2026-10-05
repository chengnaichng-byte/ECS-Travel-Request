// TR-04 Trip Details — purpose, justification, dates, itinerary, travel class and
// proposed booking method (§4.4 replaces the retrospective TRS checkbox).
import { notFound } from 'next/navigation';
import { loadRequest } from '@/modules/pretrip/queries';
import { currentPersonaId } from '@/shared/session';
import { canEditRequest } from '@/modules/pretrip/guards';
import { saveTrip } from '@/modules/pretrip/actions';
import { travelPurposes } from '@/data/travelPurposes';
import { activeProviders } from '@/data/tmcProviders';
import { airports, cities, countries } from '@/data/locations';
import { travelClasses } from '@/data/travelClass';
import { TMC_BOOKING_METHODS, NON_TMC_ARRANGEMENTS } from '@/shared/enums';
import { BookingFields } from '@/components/BookingFields';
import { TripPlanner } from '@/components/TripPlanner';
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
  const initialLegs = sortedLegs.map((l) => ({ originCode: l.originCode, destCode: l.destCode, departDate: d(l.departDate), arriveDate: d(l.arriveDate), nights: l.nights, durationHours: l.durationHours != null ? String(l.durationHours) : '', isPersonal: l.isPersonal }));
  // airport → city/country names, so the leg builder can show the derived main destination.
  const airportMeta: Record<string, { city: string; country: string }> = {};
  for (const a of airports) {
    const city = cities.find((c) => c.code === a.cityCode);
    const country = city ? countries.find((c) => c.code === city.countryCode) : undefined;
    airportMeta[a.code] = { city: city?.name ?? a.cityCode, country: country?.name ?? '' };
  }

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
          travelClasses={travelClasses.map((c) => ({ id: c.id, name: c.name }))}
          prefillClass={prefillClass}
          entitledName={entitledName}
          basis={basis}
          initialJustification={req.classJustification ?? ''}
          continueHref={`/requests/${id}/estimates`}
          disabled={!canEdit}
        />
      </form>
    </div>
  );
}

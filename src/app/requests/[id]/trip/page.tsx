// TR-04 Trip Details — purpose, justification, dates, itinerary, travel class and
// proposed booking method (§4.4 replaces the retrospective TRS checkbox).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadRequest } from '@/modules/pretrip/queries';
import { currentPersonaId } from '@/shared/session';
import { canEditRequest } from '@/modules/pretrip/guards';
import { saveTrip, addLeg, removeLeg, moveLeg } from '@/modules/pretrip/actions';
import { LegTimeline } from '@/components/LegTimeline';
import { travelPurposes } from '@/data/travelPurposes';
import { activeProviders } from '@/data/tmcProviders';
import { countries, cities, airports } from '@/data/locations';
import { travelClasses } from '@/data/travelClass';
import { TMC_BOOKING_METHODS, NON_TMC_ARRANGEMENTS } from '@/shared/enums';
import { BookingFields } from '@/components/BookingFields';
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
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="label">Origin airport</label>
              <select name="originCode" defaultValue="SIN" className="field">
                {airports.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Destination country</label>
              <select name="destCountry" defaultValue={req.destCountry ?? ''} className="field" required>
                <option value="">Select…</option>
                {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Destination city</label>
              <select name="destCity" defaultValue={req.destCity ?? ''} className="field" required>
                <option value="">Select…</option>
                {cities.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Destination airport</label>
              <select name="destAirport" defaultValue="" className="field">
                <option value="">Select…</option>
                {airports.filter((a) => a.cityCode !== 'SIN').map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Travel class</label>
              <select name="travelClassId" defaultValue={prefillClass} className="field">
                {travelClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <p className="text-xs text-[var(--ecs-muted)] mt-1">Entitled: <strong>{entitledName}</strong> · <span className="italic">{basis}</span> (§13.19)</p>
            </div>
            <div className="md:col-span-3">
              <label className="label">Justification for higher class (required if above entitlement — §13.19)</label>
              <textarea name="classJustification" defaultValue={req.classJustification ?? ''} rows={2} className="field" placeholder="e.g. medical accommodation, red-eye connection…" />
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

      {/* §13.20 Multi-leg itinerary editor — legs save immediately (outside the trip form) */}
      <div className="mt-5">
        <Card title="Itinerary — Legs (§13.20)">
          {sortedLegs.length > 0 && (
            <div className="mb-3">
              <LegTimeline legs={sortedLegs} />
              <p className="text-xs text-[var(--ecs-muted)] mt-1">Main destination (longest stay): <strong>{cities.find((c) => c.code === req.destCity)?.name ?? '—'}</strong> · derived, override via the destination city field above.</p>
            </div>
          )}
          {sortedLegs.length === 0 ? (
            <p className="text-sm text-[var(--ecs-muted)] italic mb-3">No legs yet. Saving the trip above creates a return itinerary; add legs here for multi-city trips.</p>
          ) : (
            <div className="overflow-x-auto mb-3">
              <table className="w-full text-sm">
                <thead><tr>
                  <th className="th">#</th><th className="th">Mode</th><th className="th">Route</th><th className="th">Depart</th><th className="th">Arrive</th>
                  <th className="th">Hours</th><th className="th">Book?</th><th className="th">Personal</th><th className="th">Entitled class</th><th className="th">Nights</th><th className="th"></th>
                </tr></thead>
                <tbody>
                  {sortedLegs.map((l, i) => {
                    const prev = sortedLegs[i - 1];
                    const breaksContinuity = prev?.arriveDate && l.departDate && l.departDate < prev.arriveDate;
                    return (
                      <tr key={l.id} className="hover:bg-[var(--ecs-panel-2)]">
                        <td className="td">{l.seq}</td>
                        <td className="td">{l.transportMode}</td>
                        <td className="td font-medium">{l.originCode} → {l.destCode}</td>
                        <td className={`td ${breaksContinuity ? 'text-[var(--ecs-red)]' : ''}`}>{d(l.departDate)}{l.departTime ? ` ${l.departTime}` : ''}{breaksContinuity ? ' ⚠' : ''}</td>
                        <td className="td">{d(l.arriveDate)}</td>
                        <td className="td">{l.durationHours ?? '—'}</td>
                        <td className="td">{l.bookingRequired ? '✓' : <span className="text-[var(--ecs-muted)]">no</span>}</td>
                        <td className="td">{l.isPersonal ? <span className="pill-info">personal</span> : '—'}</td>
                        <td className="td">{l.isPersonal ? '—' : (travelClasses.find((c) => c.id === l.entitledClassId)?.name ?? 'Economy')}</td>
                        <td className="td">{l.nights}</td>
                        <td className="td whitespace-nowrap">
                          <form action={moveLeg.bind(null, id, l.id, 'up')} className="inline"><button className="btn-ghost text-xs" disabled={i === 0}>↑</button></form>
                          <form action={moveLeg.bind(null, id, l.id, 'down')} className="inline"><button className="btn-ghost text-xs" disabled={i === sortedLegs.length - 1}>↓</button></form>
                          <form action={removeLeg.bind(null, id, l.id)} className="inline"><button className="btn-ghost text-xs">✕</button></form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-xs text-[var(--ecs-muted)] mt-1">Duration-conditioned entitlement is evaluated per leg (§13.19/AC40); a ⚠ marks a date-continuity break (AC41).</p>
            </div>
          )}

          {canEdit && <form action={addLeg.bind(null, id)} className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2 items-end border-t border-[var(--ecs-border)] pt-3">
            <div><label className="label">Mode</label>
              <select name="transportMode" className="field"><option value="AIR">Air</option><option value="RAIL">Rail</option><option value="OTHER">Other</option></select>
            </div>
            <div><label className="label">Origin</label>
              <select name="originCode" className="field">{airports.map((a) => <option key={a.code} value={a.code}>{a.code}</option>)}</select>
            </div>
            <div><label className="label">Destination</label>
              <select name="destCode" className="field">{airports.map((a) => <option key={a.code} value={a.code}>{a.code}</option>)}</select>
            </div>
            <div><label className="label">Depart</label><input type="date" name="departDate" className="field" /></div>
            <div><label className="label">Time</label><input type="time" name="departTime" className="field" /></div>
            <div><label className="label">Arrive</label><input type="date" name="arriveDate" className="field" /></div>
            <div><label className="label">Hours</label><input type="number" step="any" name="durationHours" className="field" placeholder="e.g. 7" /></div>
            <div><label className="label">Personal</label><div className="pt-2"><input type="checkbox" name="isPersonal" className="w-4 h-4" /></div></div>
            <div><label className="label">Booking req.</label><div className="pt-2"><input type="checkbox" name="bookingRequired" defaultChecked className="w-4 h-4" /></div></div>
            <button className="btn-secondary">Add leg</button>
          </form>}
        </Card>
      </div>
    </div>
  );
}

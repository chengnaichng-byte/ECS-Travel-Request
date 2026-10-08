// TR-14 Booking Details + §13.9 canonical TMC payloads (rendered from static mock,
// no live connectivity) + §6.4 booking-deviation handling (TR-15 reconciliation).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadRequest } from '@/modules/pretrip/queries';
import { getSettings } from '@/modules/pretrip/settings';
import { handoffToTmc, receiveBooking, markSelfBooked, resendToTmc, postAirfareToSap, setBookingTmcStatus, amendAfterFailedBooking, cancelRequest } from '@/modules/pretrip/actions';
import { fmtSgd } from '@/modules/pretrip/pricing';
import { EcsIdentity } from '@/shared/ecs/services';
import { resolveTmcProvider } from '@/modules/pretrip/tmcRouting';
import { isTmcArrangement, isSelfBooked, isHostArranged, isNoBooking, arrangementLabel } from '@/modules/pretrip/booking';
import { tmcProvider } from '@/data/tmcProviders';
import { BOOKING_STATUS, TMC_INFLIGHT_STATUSES } from '@/shared/enums';
import { Card, KV, Empty } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const req = await loadRequest(id);
  if (!req) notFound();
  const settings = await getSettings();
  const outbound = req.messages.find((m) => m.kind === 'TMC_HANDOFF');
  const inbound = req.messages.find((m) => m.kind === 'TMC_RESPONSE');
  const sapPost = req.messages.find((m) => m.kind === 'SAP_AIRFARE_POST');
  const cancelMsg = req.messages.find((m) => m.kind === 'TMC_CANCEL');
  const bookings = req.bookings;
  // §36 direct airfare posting is offered only when the setting selects it and a booking exists.
  const canPostSap = settings.airfareTreatment === 'DIRECT_SAP' && req.bookingStatus === BOOKING_STATUS.Booked && !sapPost;
  // §30/§39 TMC lifecycle — can receive a response while in flight; can advance the status.
  const inFlight = req.bookingStatus === BOOKING_STATUS.SentToTMC || TMC_INFLIGHT_STATUSES.includes(req.bookingStatus);
  // §13.3 booking window — the fare/seat may not survive an approval round-trip, so a failed
  // booking shows whether the deadline / TA validity has passed (drives re-send vs amend/cancel).
  const fmtDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '—');
  const windowRef = req.bookingDeadline ?? req.authorisationExpiry ?? null;
  const windowLabel = req.bookingDeadline ? 'booking deadline' : 'TA valid until';
  const daysLeft = windowRef ? Math.ceil((windowRef.getTime() - Date.now()) / 86400000) : null;
  const windowClosed = !!windowRef && windowRef.getTime() < Date.now();
  // Multi-TMC: the single provider this request routes to (resolved), and the one that booked.
  const routing = resolveTmcProvider(req);
  const sentProviderId = (() => { try { return outbound ? JSON.parse(outbound.payload).meta?.tmc ?? null : null; } catch { return null; } })();
  const activeProviderId = sentProviderId ?? bookings[0]?.tmcProviderId ?? routing.provider.id;
  // §9.3 group fan-out (AC15) — the outbound hand-off carries N traveller instructions.
  let fanoutCount = 0;
  if (outbound) { try { const p = JSON.parse(outbound.payload); if (p?.mode === 'GROUP_FANOUT') fanoutCount = p.instructionCount ?? p.instructions?.length ?? 0; } catch { /* ignore */ } }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {req.bookingStatus === 'Not Sent' && (
          <>
            {isTmcArrangement(req.bookingArrangement) && <form action={handoffToTmc.bind(null, id)}><button className="btn-primary">Send to TMC (mock hand-off)</button></form>}
            {(isSelfBooked(req.bookingArrangement) || settings.selfBookingEnabled) && <form action={markSelfBooked.bind(null, id)}><button className="btn-secondary">Mark self-booked (§13.17)</button></form>}
            {(isHostArranged(req.bookingArrangement) || isNoBooking(req.bookingArrangement)) && (
              <span className="text-sm text-[var(--ecs-muted)]">No TMC booking — this trip is <strong>{arrangementLabel(req.bookingArrangement)}</strong>.</span>
            )}
          </>
        )}
        {inFlight && (
          <form action={receiveBooking.bind(null, id)} className="flex items-end gap-2 flex-wrap">
            <div>
              <label className="label">Outcome</label>
              <select name="outcome" className="field" defaultValue="BOOKED">
                <option value="BOOKED">Booked</option>
                <option value="FAILED">Failed — TMC could not fulfil</option>
              </select>
            </div>
            <div>
              <label className="label">Simulate fare vs approved</label>
              <select name="overFarePct" className="field" defaultValue="0">
                <option value="0">Within tolerance (normal)</option>
                <option value="35">+35% over — deviation (S09)</option>
              </select>
            </div>
            <button className="btn-primary">Receive mock booking response</button>
          </form>
        )}
        {inFlight && (
          <form action={setBookingTmcStatus.bind(null, id)} className="flex items-end gap-2">
            <div>
              <label className="label">TMC status (§30/§39)</label>
              <select name="tmcStatus" className="field" defaultValue={BOOKING_STATUS.ReceivedByTMC}>
                {TMC_INFLIGHT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <button className="btn-secondary">Update TMC status</button>
          </form>
        )}
        {req.bookingStatus === BOOKING_STATUS.Booked && (
          <form action={setBookingTmcStatus.bind(null, id)}>
            <input type="hidden" name="tmcStatus" value={BOOKING_STATUS.TravelCompleted} />
            <button className="btn-secondary">Mark travel completed</button>
          </form>
        )}
        {req.bookingStatus === BOOKING_STATUS.Failed && (
          <div className="card p-4 w-full border-amber-200 bg-amber-50">
            <div className="font-semibold text-amber-900 mb-1">Booking failed — recovery (§6.4)</div>
            <p className="text-sm text-amber-900 mb-2">
              The TMC/OBT could not fulfil this itinerary (ticket not issued).{' '}
              {windowRef && (windowClosed
                ? <>The <b>booking window has closed</b> ({windowLabel} {fmtDate(windowRef)}) — a re-send is unlikely to succeed; <b>amend</b> or <b>cancel &amp; re-raise</b>.</>
                : <>Booking window: <b>{daysLeft} day{daysLeft === 1 ? '' : 's'}</b> left ({windowLabel} {fmtDate(windowRef)}).</>)}
            </p>
            <div className="flex flex-wrap gap-2">
              <form action={resendToTmc.bind(null, id)}><button className="btn-secondary">Re-send to TMC (retry as-is)</button></form>
              <form action={amendAfterFailedBooking.bind(null, id)}><button className="btn-secondary">Amend itinerary &amp; re-route</button></form>
              <form action={cancelRequest.bind(null, id)}><button className="btn-danger">Cancel &amp; raise a new request</button></form>
            </div>
            <p className="text-xs text-amber-800 mt-2">For an urgent trip the TMC will usually contact the traveller directly; once a replacement is booked, cancel this request so no two authorisations stay live — the duplicate check blocks a re-raise until this one is cancelled or amended.</p>
          </div>
        )}
        {canPostSap && (
          <form action={postAirfareToSap.bind(null, id)}><button className="btn-secondary">Post airfare to ERP (SAP)</button></form>
        )}
        <Link href={`/requests/${id}`} className="btn-ghost">← Back to request</Link>
      </div>

      <div className="card px-4 py-3 text-sm flex flex-wrap items-center gap-x-6 gap-y-1">
        <div><span className="text-[var(--ecs-muted)]">Booking arrangement</span> <strong className="text-[var(--ecs-navy)]">{arrangementLabel(req.bookingArrangement)}</strong></div>
        {isTmcArrangement(req.bookingArrangement) ? (
          <>
            <div><span className="text-[var(--ecs-muted)]">TMC provider</span> <strong className="text-[var(--ecs-navy)]">{tmcProvider(activeProviderId)?.name ?? routing.provider.name}</strong></div>
            <div className="text-xs text-[var(--ecs-muted)]">{req.bookingStatus === BOOKING_STATUS.NotSent ? `Will route to this provider — ${routing.reason}.` : 'Provider this request was handed off to.'}</div>
            <div className="text-xs text-[var(--ecs-muted)] font-mono">{tmcProvider(activeProviderId)?.transport}</div>
          </>
        ) : (
          <div className="text-xs text-[var(--ecs-muted)]">Not routed to a TMC.</div>
        )}
      </div>

      {req.bookingStatus === BOOKING_STATUS.Failed && (
        <div className="card p-3 text-sm text-red-800 bg-red-50 border-red-200">The TMC reported a <strong>failed booking</strong>. Review the inbound payload and re-send when ready.</div>
      )}
      {req.bookingStatus === BOOKING_STATUS.Cancelled && (
        <div className="card p-3 text-sm text-amber-800 bg-amber-50 border-amber-200">This request was <strong>cancelled</strong>; the booking is no longer active.</div>
      )}

      {fanoutCount > 1 && (
        <div className="card p-3 text-sm bg-[var(--ecs-panel-2)] border-[var(--ecs-border)]">
          <strong>Group fan-out (§9.3):</strong> one approval produced <strong>{fanoutCount}</strong> traveller-level booking instruction{fanoutCount > 1 ? 's' : ''} to the TMC.
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-5">
        <Card title={`Booking Summary (TR-14)${bookings.length > 1 ? ` — ${bookings.length} travellers` : ''}`}>
          {bookings.length === 0 ? <Empty>No booking yet. Send the approved request to the TMC, or mark it self-booked.</Empty> : (
            <div className="space-y-4">
              {bookings.map((booking) => (
                <dl key={booking.id} className="grid grid-cols-2 gap-3 pb-3 border-b border-[var(--ecs-border)] last:border-0 last:pb-0">
                  {req.isGroup && booking.travellerId && (
                    <div className="col-span-2 text-sm font-semibold text-[var(--ecs-navy)]">{EcsIdentity.employee(booking.travellerId)?.name ?? booking.travellerId}</div>
                  )}
                  <KV label="Channel">{booking.channel}</KV>
                  <KV label="Status">{booking.status}</KV>
                  <KV label="PNR">{booking.pnr ?? '—'}</KV>
                  <KV label="Ticket">{booking.ticketNo ?? '—'}</KV>
                  <KV label="Fare">{booking.fare != null ? fmtSgd(booking.fare) : '—'}</KV>
                  <KV label="Taxes & fees">{booking.taxes != null ? fmtSgd((booking.taxes ?? 0) + (booking.fees ?? 0)) : '—'}</KV>
                  <KV label="Hotel rate">{booking.hotelRate != null ? fmtSgd(booking.hotelRate) : '—'}</KV>
                </dl>
              ))}
            </div>
          )}
        </Card>

        <Card title="Booking Reconciliation (TR-15) — deviations">
          {req.deviations.length === 0 ? <Empty>No material deviations.</Empty> : (
            <ul className="space-y-2">
              {req.deviations.map((d) => (
                <li key={d.id} className="text-sm flex items-start gap-2">
                  <span className={d.material ? 'pill-exc' : 'pill-info'}>{d.material ? 'Material' : 'Minor'}</span>
                  <div><strong>{d.field}</strong>: approved {d.approvedValue} → booked {d.bookedValue}. <span className="text-[var(--ecs-muted)]">Action: {d.action}</span></div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {(outbound || inbound) && (
        <div className="grid md:grid-cols-2 gap-5">
          {outbound && (
            <Card title="Canonical Outbound Payload (§13.9)">
              <pre className="text-xs bg-[var(--ecs-panel-2)] p-3 rounded overflow-x-auto border border-[var(--ecs-border)]">{outbound.payload}</pre>
            </Card>
          )}
          {inbound && (
            <Card title="Canonical Inbound Payload (§13.9)">
              <pre className="text-xs bg-[var(--ecs-panel-2)] p-3 rounded overflow-x-auto border border-[var(--ecs-border)]">{inbound.payload}</pre>
            </Card>
          )}
        </div>
      )}

      {cancelMsg && (
        <Card title="TMC Booking Cancellation (§34)">
          <pre className="text-xs bg-[var(--ecs-panel-2)] p-3 rounded overflow-x-auto border border-[var(--ecs-border)]">{cancelMsg.payload}</pre>
        </Card>
      )}

      {sapPost && (
        <Card title="Direct Airfare Posting to ERP (§36)">
          <p className="text-xs text-[var(--ecs-muted)] mb-2">Airfare treatment is <strong>DIRECT_SAP</strong>: the booked airfare posts straight to ERP against the trip&apos;s cost objects (GL from the airfare expense type) and does <strong>not</strong> flow through the expense claim.</p>
          <pre className="text-xs bg-[var(--ecs-panel-2)] p-3 rounded overflow-x-auto border border-[var(--ecs-border)]">{sapPost.payload}</pre>
        </Card>
      )}
    </div>
  );
}

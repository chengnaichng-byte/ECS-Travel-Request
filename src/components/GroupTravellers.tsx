// §13.13/§13.14 Group travellers panel: named travellers, per-traveller derived
// share, inclusion confirmation status and management actions.
import { computeTravellerShares, unconfirmedCount, effectiveLegs, hasOwnItinerary } from '@/modules/pretrip/group';
import { fmtSgd } from '@/modules/pretrip/pricing';
import { EcsIdentity, EcsReference, EcsTravelClassRegister } from '@/shared/ecs/services';
import { employees } from '@/data/employees';
import { travelClasses } from '@/data/travelClass';
import { airports } from '@/data/locations';
import { REQUEST_STATUS } from '@/shared/enums';
import { addGroupTraveller, removeGroupTraveller, confirmInclusion, overrideConfirmations, setTravellerClass, addLeg, removeLeg, moveLeg, copyGroupItineraryToTraveller, clearTravellerItinerary } from '@/modules/pretrip/actions';
import { isFreeEditState, isAmendableState } from '@/modules/pretrip/amend';
import { LegTimeline } from './LegTimeline';
import { Card } from './ui';
import type { FullRequest } from '@/modules/pretrip/queries';

function iso(d: Date | null) { return d ? d.toISOString().slice(0, 10) : ''; }

export function GroupTravellers({ req, personaId, isAdmin, allowSub }: { req: FullRequest; personaId: string; isAdmin: boolean; allowSub: boolean }) {
  const shares = computeTravellerShares(req);
  const isDraft = isFreeEditState(req.status);
  const canEdit = isDraft || isAmendableState(req.status);   // add/remove allowed here
  const amendOnEdit = canEdit && !isDraft;                   // editing triggers reapproval (§13.14)
  const pendingConfirm = req.status === REQUEST_STATUS.PendingConfirmation;
  const myRow = req.travellers.find((t) => t.employeeId === personaId);
  const iCanConfirm = myRow && !myRow.confirmed;
  const confirmedN = req.travellers.filter((t) => t.confirmed).length;
  const candidates = employees.filter((e) => e.isTraveller && !req.travellers.some((t) => t.employeeId === e.id));

  return (
    <Card title={`Group Travellers (${req.travellers.length}) · Confirmed ${confirmedN}/${req.travellers.length}`}>
      {pendingConfirm && (
        <div className="mb-3 text-sm bg-amber-50 border border-amber-200 rounded p-3 text-amber-800">
          Approvals are complete, but the Travel Authorisation is held until all travellers confirm inclusion ({unconfirmedCount(req)} outstanding) — §13.13.
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr>
            <th className="th">Traveller</th><th className="th">Department</th>
            <th className="th text-right">Individual</th><th className="th text-right">Shared</th>
            <th className="th text-right">Share</th><th className="th">Confirmation</th><th className="th"></th>
          </tr></thead>
          <tbody>
            {shares.map((s) => {
              const row = req.travellers.find((t) => t.employeeId === s.employeeId)!;
              return (
                <tr key={s.employeeId} className="hover:bg-[var(--ecs-panel-2)]">
                  <td className="td font-medium">{s.name}{row.isRequestor && <span className="pill-navy ml-1">Requestor</span>}</td>
                  <td className="td text-xs text-[var(--ecs-muted)]">{s.department}</td>
                  <td className="td text-right">{fmtSgd(s.individualSgd)}</td>
                  <td className="td text-right">{fmtSgd(s.sharedSgd)}</td>
                  <td className="td text-right whitespace-nowrap">{fmtSgd(s.totalSgd)} <span className="text-xs text-[var(--ecs-muted)]">({s.pct.toFixed(0)}%)</span></td>
                  <td className="td">{row.confirmed ? <span className="pill-pass">Confirmed</span> : <span className="pill-warn">Pending</span>}</td>
                  <td className="td text-right">
                    {canEdit && req.travellers.length > 2 && (
                      <form action={removeGroupTraveller.bind(null, req.id, row.id)}><button className="btn-ghost text-xs">Remove</button></form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {amendOnEdit && (
        <p className="mt-3 text-xs text-amber-700">Adding or removing a traveller now is a <strong>material amendment</strong> — it releases/adds the share, re-derives the approval route and restarts reapproval (§13.14).</p>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-3">
        {iCanConfirm && (
          <form action={confirmInclusion.bind(null, req.id)}>
            <button className="btn-primary">Confirm my inclusion</button>
          </form>
        )}
        {canEdit && candidates.length > 0 && (
          <form action={addGroupTraveller.bind(null, req.id)} className="flex items-end gap-2">
            <div>
              <label className="label">Add traveller</label>
              <select name="employeeId" className="field">
                {candidates.map((e) => <option key={e.id} value={e.id}>{e.name} — {EcsIdentity.department(e.departmentId)?.name}</option>)}
              </select>
            </div>
            <button className="btn-secondary">Add</button>
          </form>
        )}
        {pendingConfirm && isAdmin && (
          <form action={overrideConfirmations.bind(null, req.id)} className="flex items-end gap-2">
            <div>
              <label className="label">Travel Admin override reason</label>
              <input name="reason" className="field w-64" placeholder="Reason for waiving confirmation…" />
            </div>
            <button className="btn-secondary">Override & authorise</button>
          </form>
        )}
      </div>

      {/* §13.19/§13.20 per-traveller travel class & itinerary overrides */}
      <div className="mt-5 border-t border-[var(--ecs-border)] pt-4">
        <div className="text-sm font-semibold text-[var(--ecs-navy)] mb-1">Per-traveller class &amp; itinerary overrides</div>
        <p className="text-xs text-[var(--ecs-muted)] mb-3">Entitlement is derived per traveller (§13.19); a class above entitlement needs that traveller&apos;s justification and routes the whole request through exception approval. A traveller may deviate with their own sub-itinerary (§13.20); their entitled class, ODA and date-aware accommodation share follow their own dates. After approval, a <strong>material</strong> deviation (date shift &gt; 2 days, cost up &gt; +10% / SGD 500, or a class increase) restarts reapproval; smaller changes are logged as non-material (§6.4).</p>
        <div className="space-y-3">
          {req.travellers.map((t) => {
            const onDate = req.startDate ?? new Date();
            const derived = EcsTravelClassRegister.entitledForItinerary(
              t.employeeId,
              req.legs.map((l) => ({ durationHours: l.durationHours, isPersonal: l.isPersonal, destCode: EcsReference.airport(l.destCode)?.cityCode ?? l.destCode })),
              onDate,
            );
            const chosen = t.chosenClassId ?? req.travelClassId ?? derived.classId;
            const upgrade = EcsTravelClassRegister.rank(chosen) > EcsTravelClassRegister.rank(derived.classId);
            return (
              <div key={t.id} className="border border-[var(--ecs-border)] rounded p-3 bg-[var(--ecs-panel-2)]">
                <div className="text-sm font-medium mb-2">{EcsIdentity.employee(t.employeeId)?.name}
                  <span className="text-xs text-[var(--ecs-muted)] font-normal"> · entitled {travelClasses.find((c) => c.id === derived.classId)?.name} ({derived.basis})</span>
                  {upgrade && <span className="pill-exc ml-2">Upgrade — needs justification</span>}
                </div>
                <form action={setTravellerClass.bind(null, req.id, t.id)} className="flex flex-wrap gap-2 items-end mb-3">
                  <div className="w-36"><label className="label">Class</label>
                    <select name="chosenClassId" defaultValue={chosen} className="field" disabled={!canEdit}>
                      {travelClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="flex-1 min-w-[180px]"><label className="label">Justification (if above entitlement)</label>
                    <input name="classJustification" defaultValue={t.classJustification ?? ''} className="field" disabled={!canEdit} placeholder="reason for upgrade…" />
                  </div>
                  <button className="btn-secondary" disabled={!canEdit}>Save class</button>
                </form>

                {/* §13.20 per-traveller sub-itinerary — gated by the groupSubItineraries setting (D3) */}
                {!allowSub ? (
                  <div className="border-t border-[var(--ecs-border)] pt-3 text-xs text-[var(--ecs-muted)]">Following the shared group itinerary — per-traveller sub-itineraries are disabled in Module Settings (§13.20).</div>
                ) : (() => {
                  const own = hasOwnItinerary(req, t.employeeId);
                  const legs = effectiveLegs(req, t.employeeId);
                  return (
                    <div className="border-t border-[var(--ecs-border)] pt-3">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="text-xs font-semibold text-[var(--ecs-muted)]">
                          Itinerary — {own ? <span className="text-[var(--ecs-navy)]">own sub-itinerary</span> : 'inherits group'}
                          {t.ownStartDate && <span> · {iso(t.ownStartDate)} → {iso(t.ownEndDate)}</span>}
                        </div>
                        {canEdit && (own
                          ? <form action={clearTravellerItinerary.bind(null, req.id, t.employeeId)}><button className="btn-ghost text-xs">Revert to group</button></form>
                          : <form action={copyGroupItineraryToTraveller.bind(null, req.id, t.employeeId)}><button className="btn-secondary text-xs">Create own itinerary</button></form>)}
                      </div>
                      {legs.length > 0 && <div className="mb-2"><LegTimeline legs={legs} /></div>}
                      {own && (
                        <>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs mb-2">
                              <thead><tr><th className="th">#</th><th className="th">Route</th><th className="th">Depart</th><th className="th">Arrive</th><th className="th">Hrs</th><th className="th">Personal</th><th className="th">Entitled</th><th className="th"></th></tr></thead>
                              <tbody>
                                {legs.map((l, i) => (
                                  <tr key={l.id} className="hover:bg-white">
                                    <td className="td">{l.seq}</td>
                                    <td className="td font-medium">{l.originCode} → {l.destCode}</td>
                                    <td className="td">{iso(l.departDate)}</td>
                                    <td className="td">{iso(l.arriveDate)}</td>
                                    <td className="td">{l.durationHours ?? '—'}</td>
                                    <td className="td">{l.isPersonal ? 'yes' : '—'}</td>
                                    <td className="td">{l.isPersonal ? '—' : (travelClasses.find((c) => c.id === l.entitledClassId)?.name ?? 'Economy')}</td>
                                    <td className="td whitespace-nowrap">
                                      <form action={moveLeg.bind(null, req.id, l.id, 'up')} className="inline"><button className="btn-ghost text-xs" disabled={!canEdit || i === 0}>↑</button></form>
                                      <form action={moveLeg.bind(null, req.id, l.id, 'down')} className="inline"><button className="btn-ghost text-xs" disabled={!canEdit || i === legs.length - 1}>↓</button></form>
                                      <form action={removeLeg.bind(null, req.id, l.id)} className="inline"><button className="btn-ghost text-xs" disabled={!canEdit}>✕</button></form>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {canEdit && (
                            <form action={addLeg.bind(null, req.id)} className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2 items-end">
                              <input type="hidden" name="travellerId" value={t.employeeId} />
                              <div><label className="label">Origin</label><select name="originCode" className="field">{airports.map((a) => <option key={a.code} value={a.code}>{a.code}</option>)}</select></div>
                              <div><label className="label">Dest</label><select name="destCode" className="field">{airports.map((a) => <option key={a.code} value={a.code}>{a.code}</option>)}</select></div>
                              <div><label className="label">Depart</label><input type="date" name="departDate" className="field" /></div>
                              <div><label className="label">Arrive</label><input type="date" name="arriveDate" className="field" /></div>
                              <div><label className="label">Hrs</label><input type="number" step="any" name="durationHours" className="field" /></div>
                              <div><label className="label">Personal</label><div className="pt-2"><input type="checkbox" name="isPersonal" className="w-4 h-4" /></div></div>
                              <button className="btn-secondary">Add leg</button>
                            </form>
                          )}
                        </>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}
          {/* end per-traveller cards */}
        </div>
      </div>
    </Card>
  );
}

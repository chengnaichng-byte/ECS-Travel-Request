'use client';
// §13.20 Per-traveller group itineraries. Declared UPFRONT: for each group traveller the requestor
// ticks "different itinerary" and enters that traveller's own legs (origin / destination / dates).
// Saving replaces their own legs and re-derives their ODA / accommodation from that itinerary; an
// unticked traveller follows the shared itinerary. Shown only when the group-sub-itineraries setting
// is on (gated by the Trip page).
import { useState } from 'react';

interface Leg { originCode: string; destCode: string; departDate: string; arriveDate: string }
export interface ItineraryMember { employeeId: string; name: string; legs: Leg[]; action: (fd: FormData) => Promise<void> }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col"><label className="text-[10px] uppercase tracking-wide text-[var(--ecs-muted)] mb-0.5">{label}</label>{children}</div>;
}

export function PerTravellerItineraries({ members, airports, sharedRoute }: {
  members: ItineraryMember[]; airports: [string, string][]; sharedRoute: string;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--ecs-muted)]">Shared itinerary: <span className="font-mono">{sharedRoute || '—'}</span>. Tick a traveller to give them a different route or dates; their ODA and accommodation are then costed on their own itinerary.</p>
      {members.map((m) => <MemberRow key={m.employeeId} m={m} airports={airports} />)}
    </div>
  );
}

function MemberRow({ m, airports }: { m: ItineraryMember; airports: [string, string][] }) {
  const [deviates, setDeviates] = useState(m.legs.length > 0);
  const [legs, setLegs] = useState<Leg[]>(m.legs.length ? m.legs : [{ originCode: 'SIN', destCode: '', departDate: '', arriveDate: '' }]);
  const setLeg = (i: number, p: Partial<Leg>) => setLegs((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const addLeg = () => setLegs((ls) => [...ls, { originCode: ls[ls.length - 1]?.destCode || 'SIN', destCode: '', departDate: '', arriveDate: '' }]);
  const delLeg = (i: number) => setLegs((ls) => ls.filter((_, j) => j !== i));
  const json = JSON.stringify(legs.filter((l) => l.originCode && l.destCode));

  return (
    <div className="rounded border border-[var(--ecs-border)] p-3">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={deviates} onChange={(e) => setDeviates(e.target.checked)} className="w-4 h-4" />
        {m.name}
        <span className="text-xs font-normal text-[var(--ecs-muted)]">· {deviates ? 'own itinerary' : 'follows the shared itinerary'}</span>
      </label>

      {deviates && (
        <form action={m.action} className="mt-3 space-y-2">
          <input type="hidden" name="legsJson" value={json} />
          {legs.map((l, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <Field label="From"><select value={l.originCode} onChange={(e) => setLeg(i, { originCode: e.target.value })} className="field w-28">{airports.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></Field>
              <Field label="To"><select value={l.destCode} onChange={(e) => setLeg(i, { destCode: e.target.value })} className="field w-28"><option value="">—</option>{airports.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></Field>
              <Field label="Depart"><input type="date" value={l.departDate} onChange={(e) => setLeg(i, { departDate: e.target.value, arriveDate: l.arriveDate || e.target.value })} className="field w-36" /></Field>
              <Field label="Arrive"><input type="date" value={l.arriveDate} onChange={(e) => setLeg(i, { arriveDate: e.target.value })} className="field w-36" /></Field>
              {legs.length > 1 && <button type="button" onClick={() => delLeg(i)} className="btn-ghost text-xs text-[var(--ecs-red)] mb-1" aria-label="Remove leg">✕</button>}
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={addLeg} className="btn-secondary text-xs">＋ Add leg</button>
            <button className="btn-primary text-xs">Save itinerary</button>
          </div>
        </form>
      )}

      {!deviates && m.legs.length > 0 && (
        <form action={m.action} className="mt-2">
          <input type="hidden" name="legsJson" value="[]" />
          <button className="btn-ghost text-xs">Revert to the shared itinerary</button>
        </form>
      )}
    </div>
  );
}

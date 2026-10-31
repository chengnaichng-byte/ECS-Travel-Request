'use client';
// TR-06 individual / guest airfare add+edit form. §13.19: a proposed travel class ABOVE the
// traveller's derived entitlement is an upgrade and REQUIRES a justification. The submit button is
// disabled, with an inline message, until a justification is entered — so the airfare cannot be
// added while the upgrade is unjustified. (A group books each traveller at their entitlement, so the
// group airfare form has no class choice and uses the server-rendered form instead.)
import { useState } from 'react';

interface ProvostOpt { approverId: string; name: string; title: string; dept: string }
interface Defaults { origin: string; dest: string; proposedClassId: string; expectedDate: string; currency: string; amount: string; sponsorship: string; classJustification: string; upgradeFunding: string }

export function AirfareForm({
  action, submitLabel, editing, cancel, returnTo,
  originOpts, destOpts, classOpts, classRanks, currencyOpts,
  defaults, entitledClassId, entitledClassName,
  guest, provostOpts, provostDefault, guestUpgrading, multiCityNote, legAction, legs, multiCity, m6Note,
}: {
  action: (fd: FormData) => Promise<void>;
  submitLabel: string; editing: boolean; cancel?: React.ReactNode; returnTo?: string;
  originOpts: [string, string][]; destOpts: [string, string][]; classOpts: [string, string][];
  classRanks: Record<string, number>; currencyOpts: string[];
  defaults: Defaults; entitledClassId: string; entitledClassName: string;
  guest: boolean; provostOpts: ProvostOpt[]; provostDefault: string; guestUpgrading: boolean;
  // §13.20 multi-city note — lists the full itinerary and explains the two ways to book the fare;
  // rendered above the fields. Null for single-destination trips.
  multiCityNote?: React.ReactNode;
  // §13.20 the traveller can book the multi-city fare as one combined ticket OR as separate per-leg
  // tickets. legAction creates one airfare line per filled leg; legs are the itinerary sectors
  // [origin, dest] used to pre-fill the per-leg table. Present only for a multi-city ADD.
  legAction?: (fd: FormData) => Promise<void>;
  legs?: [string, string][];
  // §13.20 for a multi-city trip the single Origin / Destination is only a HEADLINE for the fare —
  // relabel them "Departure from" / "Primary destination" so a loop trip that returns home doesn't
  // read as if its destination were home. The full route is carried from the itinerary regardless.
  multiCity?: boolean;
  // §13.19 M6 note — shown when the traveller's policy group attracts M6 (the entitlement differential
  // is funded automatically). Rendered in place of the old upgrade-funding control. Null otherwise.
  m6Note?: React.ReactNode;
}) {
  const [proposed, setProposed] = useState(defaults.proposedClassId);
  const [justification, setJustification] = useState(defaults.classJustification);
  const entRank = classRanks[entitledClassId] ?? 1;
  const isUpgrade = (classRanks[proposed] ?? 1) > entRank;
  const needJustification = isUpgrade && !justification.trim();
  const proposedName = classOpts.find(([v]) => v === proposed)?.[1] ?? proposed;
  // Offer the one-ticket / per-leg choice only when per-leg is possible: a multi-city ADD with legs.
  const canPerLeg = !editing && !!legAction && !!legs && legs.length > 0;
  const [mode, setMode] = useState<'ONE' | 'PERLEG'>('ONE');

  const oneTicketForm = (
      <form action={action} className="space-y-3">
        {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
        {/* Intro on the left, Save (+ Cancel) pinned to the top-right of the card. */}
        <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
          <p className="text-xs text-[var(--ecs-muted)] max-w-md">{editing ? 'Editing this airfare line — change the values and save.' : <>Airfare is a <b>quoted fare</b> (not policy-derived) — add it from your quote.</>}</p>
          <div className="flex items-center gap-2 shrink-0 ml-auto">
            {cancel}
            <button className="btn-primary" disabled={needJustification}>{submitLabel}</button>
          </div>
        </div>
        {multiCityNote}
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">{multiCity ? 'Departure from' : 'Origin'}</label><select name="originCode" defaultValue={defaults.origin} className="field">{originOpts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div><label className="label">{multiCity ? 'Primary destination' : 'Destination'}</label><select name="destCode" defaultValue={defaults.dest} className="field">{destOpts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div><label className="label">Proposed class</label><select name="proposedClassId" value={proposed} onChange={(e) => setProposed(e.target.value)} className="field">{classOpts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          {/* Expected date of travel is READ-ONLY here — it is the airfare's flight date, which is
              the itinerary's business, not a second value to key on this line (that would drift from
              the legs). Derived from the matching leg's departure; change it on the Trip step. A hidden
              input carries the derived value so the stored line stays consistent. */}
          <div>
            <label className="label">Expected date of travel</label>
            <div className="field bg-[var(--ecs-panel)] text-[var(--ecs-muted)] cursor-not-allowed flex items-center justify-between gap-2">
              <span>{defaults.expectedDate || 'Set on the Trip step'}</span>
              <span className="text-[11px] whitespace-nowrap">from the itinerary</span>
            </div>
            <input type="hidden" name="expectedDate" value={defaults.expectedDate} />
            <p className="text-xs text-[var(--ecs-muted)] mt-1">Derived from the itinerary — to change it, edit the leg dates on the Trip step.</p>
          </div>
          <div><label className="label">Currency</label><select name="currency" defaultValue={defaults.currency} className="field">{currencyOpts.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
          <div><label className="label">Quoted amount</label><input name="amount" type="number" step="any" defaultValue={defaults.amount || undefined} className="field" /></div>
          <div><label className="label">Expected sponsorship</label><input name="sponsorship" type="number" step="any" defaultValue={defaults.sponsorship || undefined} className="field" /></div>
        </div>

        {/* §13.19 M6 entitlement differential — automatic, funded from an M6 account; no action here. */}
        {m6Note}

        <div>
          <label className="label">Justification{isUpgrade ? ' — class above entitlement (policy exception, §13.19)' : ' (required only if you request a class above entitlement — §13.19)'}</label>
          <textarea name="classJustification" value={justification} onChange={(e) => setJustification(e.target.value)} rows={2}
            className={`field ${needJustification ? '!border-[var(--ecs-red)]' : ''}`} placeholder="e.g. medical reason, red-eye connection…" />
          <p className="text-xs text-[var(--ecs-muted)] mt-1">Entitled: <strong>{entitledClassName}</strong> for this itinerary. A class <strong>above</strong> your entitlement is a <strong>policy exception</strong> — it needs a justification and is routed to a policy-exception approver.</p>
          {needJustification && <p className="text-xs text-[var(--ecs-red)] mt-1">{proposedName} is above your {entitledClassName} entitlement — enter a justification for the exception before this airfare can be added.</p>}
        </div>

        {/* §8 / DD-25 Guest travel-class upgrade — a guest booked above Economy needs a host-school Provost. */}
        {guest && (
          <div className="rounded border border-[var(--ecs-border)] bg-[var(--ecs-panel-2)] p-3">
            <label className="label">Provost authorisation (required for a guest booked above Economy — §8 / DD-25)</label>
            <select name="provostId" defaultValue={provostDefault} className="field">
              <option value="">— No upgrade / Economy (no Provost needed) —</option>
              {provostOpts.map((p) => <option key={p.approverId} value={p.approverId}>{p.name} · {p.title} ({p.dept})</option>)}
            </select>
            <p className="text-xs text-[var(--ecs-muted)] mt-1">A guest flies <strong>Economy</strong> by default. Selecting a higher proposed class requires a justification <em>and</em> a Provost from the host school&apos;s list; approval routes to the Provost before the host DOA.{guestUpgrading && !provostDefault && <span className="text-[var(--ecs-red)]"> This guest is above Economy — select a Provost.</span>}</p>
          </div>
        )}

        {needJustification && <p className="text-xs text-[var(--ecs-red)]">Add a justification for the class upgrade to enable Save.</p>}
      </form>
  );

  // Booking the multi-city fare as separate tickets: one fare row per itinerary sector; submit
  // creates one airfare line per filled leg (at the entitlement class).
  const perLegForm = canPerLeg ? (
    <form action={legAction} className="space-y-3">
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
      <input type="hidden" name="legCount" value={legs!.length} />
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <p className="text-xs text-[var(--ecs-muted)] max-w-md">Enter a fare for each leg you&apos;re booking as a <b>separate ticket</b>. Leave a leg blank to skip it — each filled leg becomes its own airfare line at your <b>{entitledClassName}</b> entitlement.</p>
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          {cancel}
          <button className="btn-primary">Add per-leg airfares</button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr>
            <th className="th">Leg</th><th className="th">From</th><th className="th">To</th><th className="th">Currency</th><th className="th">Quoted fare</th>
          </tr></thead>
          <tbody>
            {legs!.map(([o, dd], i) => (
              <tr key={i}>
                <td className="td whitespace-nowrap font-medium">Leg {i + 1}</td>
                <td className="td"><select name={`legOrigin_${i}`} defaultValue={o} className="field">{originOpts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
                <td className="td"><select name={`legDest_${i}`} defaultValue={dd} className="field">{originOpts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
                <td className="td"><select name={`legCurrency_${i}`} defaultValue="SGD" className="field !w-24">{currencyOpts.map((c) => <option key={c} value={c}>{c}</option>)}</select></td>
                <td className="td"><input name={`legAmount_${i}`} type="number" step="any" min="0" className="field" placeholder="—" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[var(--ecs-muted)]">Need a higher class on a leg? Add it, then use <b>Edit</b> on that line to change the class and record the upgrade justification.</p>
    </form>
  ) : null;

  if (!canPerLeg) return oneTicketForm;
  return (
    <div className="space-y-3">
      <div>
        <label className="label">How is the airfare booked?</label>
        <div className="inline-flex rounded-md border border-[var(--ecs-border)] overflow-hidden text-xs">
          <button type="button" onClick={() => setMode('ONE')} aria-pressed={mode === 'ONE'}
            className={`px-3 py-1.5 cursor-pointer ${mode === 'ONE' ? 'bg-[var(--ecs-navy)] text-white font-medium' : 'bg-white text-[var(--ecs-navy)] hover:bg-[var(--ecs-panel-2)]'}`}>Book as one ticket</button>
          <button type="button" onClick={() => setMode('PERLEG')} aria-pressed={mode === 'PERLEG'}
            className={`px-3 py-1.5 border-l border-[var(--ecs-border)] cursor-pointer ${mode === 'PERLEG' ? 'bg-[var(--ecs-navy)] text-white font-medium' : 'bg-white text-[var(--ecs-navy)] hover:bg-[var(--ecs-panel-2)]'}`}>Book per leg</button>
        </div>
      </div>
      {mode === 'PERLEG' ? perLegForm : oneTicketForm}
    </div>
  );
}

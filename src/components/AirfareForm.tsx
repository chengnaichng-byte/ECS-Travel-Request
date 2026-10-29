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
  action, submitLabel, editing, cancel,
  originOpts, destOpts, classOpts, classRanks, currencyOpts,
  defaults, entitledClassId, entitledClassName,
  guest, provostOpts, provostDefault, guestUpgrading,
}: {
  action: (fd: FormData) => Promise<void>;
  submitLabel: string; editing: boolean; cancel?: React.ReactNode;
  originOpts: [string, string][]; destOpts: [string, string][]; classOpts: [string, string][];
  classRanks: Record<string, number>; currencyOpts: string[];
  defaults: Defaults; entitledClassId: string; entitledClassName: string;
  guest: boolean; provostOpts: ProvostOpt[]; provostDefault: string; guestUpgrading: boolean;
}) {
  const [proposed, setProposed] = useState(defaults.proposedClassId);
  const [justification, setJustification] = useState(defaults.classJustification);
  const entRank = classRanks[entitledClassId] ?? 1;
  const isUpgrade = (classRanks[proposed] ?? 1) > entRank;
  const needJustification = isUpgrade && !justification.trim();
  const proposedName = classOpts.find(([v]) => v === proposed)?.[1] ?? proposed;

  return (
    <>
      <p className="text-xs text-[var(--ecs-muted)] mb-2">{editing ? 'Editing this airfare line — change the values and save.' : <>Airfare is a <b>quoted fare</b> (not policy-derived) — add it from your quote.</>}</p>
      <form action={action} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Origin</label><select name="originCode" defaultValue={defaults.origin} className="field">{originOpts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div><label className="label">Destination</label><select name="destCode" defaultValue={defaults.dest} className="field">{destOpts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div><label className="label">Proposed class</label><select name="proposedClassId" value={proposed} onChange={(e) => setProposed(e.target.value)} className="field">{classOpts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div><label className="label">Expected date</label><input name="expectedDate" type="date" defaultValue={defaults.expectedDate} className="field" /></div>
          <div><label className="label">Currency</label><select name="currency" defaultValue={defaults.currency} className="field">{currencyOpts.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
          <div><label className="label">Quoted amount</label><input name="amount" type="number" step="any" defaultValue={defaults.amount || undefined} className="field" /></div>
          <div><label className="label">Expected sponsorship</label><input name="sponsorship" type="number" step="any" defaultValue={defaults.sponsorship || undefined} className="field" /></div>
        </div>

        <div>
          <label className="label">Justification for higher class{isUpgrade ? ' (required — above entitlement, §13.19)' : ' (required if above entitlement — §13.19)'}</label>
          <textarea name="classJustification" value={justification} onChange={(e) => setJustification(e.target.value)} rows={2}
            className={`field ${needJustification ? '!border-[var(--ecs-red)]' : ''}`} placeholder="e.g. medical accommodation, red-eye connection…" />
          <p className="text-xs text-[var(--ecs-muted)] mt-1">Entitled: <strong>{entitledClassName}</strong> for this itinerary. Choosing a higher proposed class requires a justification.</p>
          {needJustification && <p className="text-xs text-[var(--ecs-red)] mt-1">{proposedName} is above your {entitledClassName} entitlement — enter a justification before this airfare can be added.</p>}
        </div>

        {/* #14 travel-class upgrade — only the funding choice is captured here; the entitlement fare and
            the differential are derived (Model B) and the M6 account is chosen on the Charging step. */}
        <div className="rounded border border-[var(--ecs-border)] bg-[var(--ecs-panel-2)] p-3 space-y-2">
          <label className="label">If above entitlement — upgrade funded by</label>
          <select name="upgradeFunding" defaultValue={defaults.upgradeFunding} className="field">
            <option value="NTU">NTU — differential charged to an M6 account</option>
            <option value="SELF">Self-funded — traveller pays the TMC</option>
          </select>
          <p className="text-xs text-[var(--ecs-muted)]">Only applies when the proposed class is above your <strong>{entitledClassName}</strong> entitlement. The entitlement fare and the upgrade differential are derived automatically from the configured uplift&nbsp;% for the class step (entitlement = chosen fare ÷ (1&nbsp;+&nbsp;uplift&nbsp;%)); the entitlement stays on your WBS/CC. <strong>NTU-funded</strong> charges the differential to an M6 account — select which on the Charging step; <strong>self-funded</strong> means you settle the differential with the TMC directly (not reimbursed).</p>
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

        <button className="btn-primary w-full" disabled={needJustification}>{submitLabel}</button>
        {needJustification && <p className="text-xs text-[var(--ecs-red)] text-center">Add a justification for the class upgrade to enable this.</p>}
        {cancel}
      </form>
    </>
  );
}

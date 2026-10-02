'use client';
// TR-02 create form with Individual / Group mode (§13.14). Group mode lets a
// requestor (who may not be a traveller) name multiple travellers.
import { useState } from 'react';
import { createDraft, createGroupDraft, createGuestDraft } from '@/modules/pretrip/actions';

interface Opt { id: string; name: string; title: string; dept: string; delegated: boolean }
const MODE_LABEL = { individual: 'Individual request', group: 'Group request', guest: 'Guest / non-employee' } as const;
type Mode = keyof typeof MODE_LABEL;

export function NewRequestForm({ persona, isRequestor, options, groupEnabled }: {
  persona: { name: string; title: string }; isRequestor: boolean; options: Opt[]; groupEnabled: boolean;
}) {
  const [mode, setMode] = useState<Mode>('individual');
  const defaultTraveller = options[0]?.id;
  const modes: Mode[] = groupEnabled ? ['individual', 'group', 'guest'] : ['individual', 'guest'];

  return (
    <div>
      <div className="card p-2 mb-4 inline-flex gap-1">
        {modes.map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)}
            className={mode === m ? 'btn-primary' : 'btn-ghost'}>
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      {mode === 'guest' ? (
        <form action={createGuestDraft}>
          <div className="card">
            <div className="card-head">Guest / Non-Employee Traveller (§8)</div>
            <div className="p-4 space-y-4">
              <div>
                <label className="label">Host / Requestor (you)</label>
                <div className="text-sm px-3 py-2 bg-[var(--ecs-panel-2)] rounded border border-[var(--ecs-border)]">
                  {persona.name} — {persona.title}
                </div>
              </div>
              <div>
                <label className="label" htmlFor="guestName">Guest name</label>
                <input id="guestName" name="guestName" required className="field" placeholder="e.g. Prof Maria Santos" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label" htmlFor="guestEmail">Guest email</label>
                  <input id="guestEmail" name="guestEmail" type="email" className="field" placeholder="maria.santos@example.edu" />
                </div>
                <div>
                  <label className="label" htmlFor="guestOrg">Home organisation</label>
                  <input id="guestOrg" name="guestOrg" className="field" placeholder="e.g. MIT" />
                </div>
              </div>
              <p className="text-xs text-[var(--ecs-muted)]">The guest has no ECS/HR profile; their identity is captured here and the trip is charged to your department. Entitlement defaults to Economy unless an exception is approved (§8, AC7).</p>
            </div>
          </div>
          <div className="mt-4 flex justify-end"><button className="btn-primary">Create guest draft →</button></div>
        </form>
      ) : mode === 'individual' ? (
        <form action={createDraft}>
          <div className="card">
            <div className="card-head">Traveller</div>
            <div className="p-4 space-y-4">
              <div>
                <label className="label">Requestor (you)</label>
                <div className="text-sm px-3 py-2 bg-[var(--ecs-panel-2)] rounded border border-[var(--ecs-border)]">
                  {persona.name} — {persona.title}{isRequestor && <span className="pill-navy ml-1">Travel Requestor</span>}
                </div>
              </div>
              <div>
                <label className="label" htmlFor="travellerId">Traveller</label>
                <select id="travellerId" name="travellerId" className="field" defaultValue={defaultTraveller}>
                  {options.map((e) => <option key={e.id} value={e.id}>{e.name} — {e.title} ({e.dept}){e.delegated ? ' · delegated' : ''}</option>)}
                </select>
                {isRequestor && <p className="text-xs text-[var(--ecs-muted)] mt-1">Creating on behalf of a traveller; approval, entitlements and declarations derive from the traveller (§13.13).</p>}
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-end"><button className="btn-primary">Create draft →</button></div>
        </form>
      ) : (
        <form action={createGroupDraft}>
          <div className="card">
            <div className="card-head">Group Travellers</div>
            <div className="p-4">
              <label className="label">Requestor (you)</label>
              <div className="text-sm px-3 py-2 bg-[var(--ecs-panel-2)] rounded border border-[var(--ecs-border)] mb-4">
                {persona.name} — {persona.title}{isRequestor && <span className="pill-navy ml-1">Travel Requestor</span>}
              </div>
              <label className="label">Select travellers (each must confirm inclusion — §13.13)</label>
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {options.map((e) => (
                  <label key={e.id} className="flex items-center gap-2.5 px-3 py-2 rounded border border-[var(--ecs-border)] hover:bg-[var(--ecs-panel-2)] cursor-pointer">
                    <input type="checkbox" name="travellerIds" value={e.id} className="w-4 h-4" />
                    <span className="text-sm">{e.name} <span className="text-[var(--ecs-muted)]">— {e.title} ({e.dept})</span></span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-[var(--ecs-muted)] mt-3">The request is approved once on the group total; the DOA is derived from the highest charging department. The requestor holds no cost share (§13.14).</p>
            </div>
          </div>
          <div className="mt-4 flex justify-end"><button className="btn-primary">Create group draft →</button></div>
        </form>
      )}
    </div>
  );
}

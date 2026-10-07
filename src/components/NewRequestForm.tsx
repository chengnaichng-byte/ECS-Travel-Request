'use client';
// TR-02 create form — Individual / Group / Guest (§13.14, §8). A group may mix employee
// members and guest (non-employee) members, up to the configured TMC group-booking limit.
import { useState } from 'react';
import { createDraft, createGroupDraft, createGuestDraft } from '@/modules/pretrip/actions';

interface Opt { id: string; name: string; title: string; dept: string; delegated: boolean }
interface GuestRow { name: string; email: string; org: string }
const MODE_LABEL = { individual: 'Individual request', group: 'Group request', guest: 'Guest / non-employee' } as const;
type Mode = keyof typeof MODE_LABEL;

export function NewRequestForm({ persona, isRequestor, options, groupOptions, groupMax, groupEnabled }: {
  persona: { name: string; title: string }; isRequestor: boolean;
  options: Opt[]; groupOptions: Opt[]; groupMax: number; groupEnabled: boolean;
}) {
  const [mode, setMode] = useState<Mode>('individual');
  const defaultTraveller = options[0]?.id;
  const modes: Mode[] = groupEnabled ? ['individual', 'group', 'guest'] : ['individual', 'guest'];

  // Group state (employee selection + guest members)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [guests, setGuests] = useState<GuestRow[]>([]);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const setGuest = (i: number, p: Partial<GuestRow>) => setGuests((g) => g.map((r, j) => j === i ? { ...r, ...p } : r));
  const addGuest = () => setGuests((g) => [...g, { name: '', email: '', org: '' }]);
  const delGuest = (i: number) => setGuests((g) => g.filter((_, j) => j !== i));
  const namedGuests = guests.filter((g) => g.name.trim());
  const total = selected.size + namedGuests.length;
  const over = total > groupMax;
  const tooFew = total < 2;

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
                <div className="text-sm px-3 py-2 bg-[var(--ecs-panel-2)] rounded border border-[var(--ecs-border)]">{persona.name} — {persona.title}</div>
              </div>
              <div>
                <label className="label" htmlFor="guestName">Guest name</label>
                <input id="guestName" name="guestName" required className="field" placeholder="e.g. Prof Maria Santos" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label" htmlFor="guestEmail">Guest email</label><input id="guestEmail" name="guestEmail" type="email" className="field" placeholder="maria.santos@example.edu" /></div>
                <div><label className="label" htmlFor="guestOrg">Home organisation</label><input id="guestOrg" name="guestOrg" className="field" placeholder="e.g. MIT" /></div>
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
                <div className="text-sm px-3 py-2 bg-[var(--ecs-panel-2)] rounded border border-[var(--ecs-border)]">{persona.name} — {persona.title}{isRequestor && <span className="pill-navy ml-1">Travel Requestor</span>}</div>
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
          {[...selected].map((id) => <input key={id} type="hidden" name="travellerIds" value={id} />)}
          <input type="hidden" name="guestsJson" value={JSON.stringify(namedGuests.map((g) => ({ name: g.name.trim(), email: g.email.trim(), org: g.org.trim() })))} />
          <div className="card">
            <div className="card-head flex items-center justify-between">
              <span>Group Travellers</span>
              <span className={`text-xs font-normal ${over ? 'text-[var(--ecs-red)]' : 'text-[var(--ecs-muted)]'}`}>{total} of max {groupMax}</span>
            </div>
            <div className="p-4">
              <label className="label">Requestor (you)</label>
              <div className="text-sm px-3 py-2 bg-[var(--ecs-panel-2)] rounded border border-[var(--ecs-border)] mb-4">{persona.name} — {persona.title}{isRequestor && <span className="pill-navy ml-1">Travel Requestor</span>}</div>

              <label className="label">Employee travellers (each confirms inclusion — §13.13)</label>
              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {groupOptions.map((e) => (
                  <label key={e.id} className="flex items-center gap-2.5 px-3 py-2 rounded border border-[var(--ecs-border)] hover:bg-[var(--ecs-panel-2)] cursor-pointer">
                    <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} className="w-4 h-4" />
                    <span className="text-sm">{e.name} <span className="text-[var(--ecs-muted)]">— {e.title} ({e.dept})</span></span>
                  </label>
                ))}
              </div>

              <div className="flex items-center justify-between mt-4 mb-1">
                <label className="label mb-0">Guest members (non-employees, §8)</label>
                <button type="button" className="btn-ghost text-xs" onClick={addGuest}>＋ Add guest</button>
              </div>
              {guests.length === 0 ? (
                <p className="text-xs text-[var(--ecs-muted)]">Add external speakers or collaborators travelling with the group. A guest flies Economy by default, is charged to your (host) department, and is settled centrally — guests do not file their own claim.</p>
              ) : (
                <div className="space-y-2">
                  {guests.map((g, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
                      <input className="field" placeholder="Guest name" value={g.name} onChange={(e) => setGuest(i, { name: e.target.value })} />
                      <input className="field" placeholder="Email (optional)" value={g.email} onChange={(e) => setGuest(i, { email: e.target.value })} />
                      <input className="field" placeholder="Organisation" value={g.org} onChange={(e) => setGuest(i, { org: e.target.value })} />
                      <button type="button" className="btn-ghost text-xs" onClick={() => delGuest(i)}>✕</button>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-xs text-[var(--ecs-muted)] mt-3">Approved once on the group total; the DOA is derived from the highest charging department. The requestor holds no cost share (§13.14). A group booking is limited to <strong>{groupMax}</strong> travellers (TMC group limit).</p>
              {over && <p className="text-xs text-[var(--ecs-red)] mt-1">Over the limit — remove {total - groupMax} traveller{total - groupMax > 1 ? 's' : ''}.</p>}
            </div>
          </div>
          <div className="mt-4 flex justify-end"><button className="btn-primary" disabled={over || tooFew}>Create group draft →</button></div>
        </form>
      )}
    </div>
  );
}

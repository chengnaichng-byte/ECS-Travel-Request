'use client';
// §4.5/§13.20 Per-traveller personal days for a GROUP — a dropdown picks one travelling member, and
// only then their personal-days editor expands for input. Saving (its own form + server action) redirects
// back to the Trip step, so the page reloads and the dropdown resets to collapsed. One form on screen at
// a time → no long stacked forms. Staff / student members only (guests do not declare); each declares
// their OWN ranges (before / during / after), independent of the others.
import { useMemo, useState } from 'react';
import { type PersonalPeriod } from '@/modules/pretrip/personal';

const toD = (s: string) => (s ? new Date(`${s}T00:00:00Z`) : null);

export interface PersonalMember {
  employeeId: string;
  name: string;
  tripStart: string;   // the member's effective window (ISO), for min/max + validation
  tripEnd: string;
  initial: PersonalPeriod[];
  action: (fd: FormData) => void | Promise<void>;
}

export function GroupPersonalDays({ members, disabled }: { members: PersonalMember[]; disabled?: boolean }) {
  const [sel, setSel] = useState('');
  const m = members.find((x) => x.employeeId === sel);
  return (
    <div className="space-y-3">
      <div>
        <label className="label">Traveller</label>
        <select value={sel} onChange={(e) => setSel(e.target.value)} disabled={disabled} className="field md:max-w-md">
          <option value="">Select a traveller…</option>
          {members.map((x) => (
            <option key={x.employeeId} value={x.employeeId}>
              {x.name} — {x.initial.length ? `${x.initial.length} personal period${x.initial.length > 1 ? 's' : ''}` : 'none'}
            </option>
          ))}
        </select>
      </div>
      {m && <MemberEditor key={m.employeeId} m={m} disabled={disabled} onCancel={() => setSel('')} />}
    </div>
  );
}

function MemberEditor({ m, disabled, onCancel }: { m: PersonalMember; disabled?: boolean; onCancel: () => void }) {
  const [periods, setPeriods] = useState<PersonalPeriod[]>(m.initial.length ? m.initial : []);
  const add = () => setPeriods((ps) => [...ps, { start: m.tripStart || '', end: m.tripEnd || '' }]);
  const set = (i: number, patch: Partial<PersonalPeriod>) => setPeriods((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const remove = (i: number) => setPeriods((ps) => ps.filter((_, j) => j !== i));

  const errors = useMemo(() => {
    const e: string[] = [];
    const ts = toD(m.tripStart), te = toD(m.tripEnd);
    periods.forEach((p, i) => {
      const s = toD(p.start), en = toD(p.end);
      if (s && en && en < s) e.push(`Period ${i + 1}: end is before its start.`);
      if (s && ts && te && (s < ts || s > te)) e.push(`Period ${i + 1}: start is outside ${m.name}'s travel dates.`);
      if (en && ts && te && (en < ts || en > te)) e.push(`Period ${i + 1}: end is outside ${m.name}'s travel dates.`);
    });
    return e;
  }, [periods, m.tripStart, m.tripEnd, m.name]);

  return (
    <form action={m.action} className="rounded border border-[var(--ecs-border)] p-3 space-y-2">
      <div className="text-sm font-semibold text-[var(--ecs-navy)]">{m.name}</div>
      <input type="hidden" name="personalPeriodsJson" value={JSON.stringify(periods.filter((p) => p.start && p.end))} />
      {periods.length === 0 ? (
        <p className="text-sm text-[var(--ecs-muted)] italic">No personal days yet — add a range, or save to leave this member on official business only.</p>
      ) : (
        periods.map((p, i) => (
          <div key={i} className="grid md:grid-cols-[1fr_1fr_2fr_auto] gap-2 items-end">
            <div>
              <label className="text-[11px] text-[var(--ecs-muted)]">From</label>
              <input type="date" value={p.start} min={m.tripStart || undefined} max={m.tripEnd || undefined} onChange={(e) => set(i, { start: e.target.value })} disabled={disabled} className="field" />
            </div>
            <div>
              <label className="text-[11px] text-[var(--ecs-muted)]">To</label>
              <input type="date" value={p.end} min={p.start || m.tripStart || undefined} max={m.tripEnd || undefined} onChange={(e) => set(i, { end: e.target.value })} disabled={disabled} className="field" />
            </div>
            <div>
              <label className="text-[11px] text-[var(--ecs-muted)]">Note (optional)</label>
              <input type="text" value={p.note ?? ''} onChange={(e) => set(i, { note: e.target.value })} disabled={disabled} className="field" placeholder="e.g. personal days after the event" />
            </div>
            {!disabled && <button type="button" onClick={() => remove(i)} aria-label="Remove" className="h-[38px] px-3 rounded border border-[var(--ecs-border)] text-[var(--ecs-muted)] hover:text-[var(--ecs-red)] hover:border-[var(--ecs-red)]">✕</button>}
          </div>
        ))
      )}
      {errors.length > 0 && <ul className="text-[12px] text-red-700 list-disc pl-4">{errors.map((x, i) => <li key={i}>{x}</li>)}</ul>}
      {!disabled && (
        <div className="flex items-center gap-2 pt-1">
          <button type="button" onClick={add} className="btn-secondary text-xs">＋ Add personal days</button>
          <button type="submit" disabled={errors.length > 0} className="btn-primary text-xs disabled:opacity-50">Save {m.name.split(' ').slice(-1)[0]}&apos;s personal days</button>
          <button type="button" onClick={onCancel} className="btn-ghost text-xs">Cancel</button>
        </div>
      )}
    </form>
  );
}

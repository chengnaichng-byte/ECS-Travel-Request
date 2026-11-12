'use client';
// §4.5/§13.20 Per-traveller personal days for a GROUP member — a compact row per member that mirrors
// the per-traveller itineraries card: a tick reveals that member's personal-days editor; an unticked
// member has none. Each staff / student member declares their OWN ranges (before / during / after),
// independent of the others — there is no group-wide personal extension. Its own form + Save (the
// per-member rows cannot nest inside the main trip form). Guests do not declare.
import { useMemo, useState } from 'react';
import { type PersonalPeriod } from '@/modules/pretrip/personal';

const toD = (s: string) => (s ? new Date(`${s}T00:00:00Z`) : null);

export function TravellerPersonalDays({ name, tripStart, tripEnd, initial, disabled, action }: {
  name: string;
  tripStart: string;    // the member's effective window (ISO), for min/max + validation
  tripEnd: string;
  initial: PersonalPeriod[];
  disabled?: boolean;
  action: (fd: FormData) => void | Promise<void>;
}) {
  const [declares, setDeclares] = useState(initial.length > 0);
  const [periods, setPeriods] = useState<PersonalPeriod[]>(initial.length ? initial : []);
  const add = () => setPeriods((ps) => [...ps, { start: tripStart || '', end: tripEnd || '' }]);
  const set = (i: number, patch: Partial<PersonalPeriod>) => setPeriods((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const remove = (i: number) => setPeriods((ps) => ps.filter((_, j) => j !== i));

  const toggle = (on: boolean) => {
    setDeclares(on);
    if (on && periods.length === 0) setPeriods([{ start: tripStart || '', end: tripEnd || '' }]);
  };

  const errors = useMemo(() => {
    const e: string[] = [];
    const ts = toD(tripStart), te = toD(tripEnd);
    periods.forEach((p, i) => {
      const s = toD(p.start), en = toD(p.end);
      if (s && en && en < s) e.push(`Period ${i + 1}: end is before its start.`);
      if (s && ts && te && (s < ts || s > te)) e.push(`Period ${i + 1}: start is outside ${name}'s travel dates.`);
      if (en && ts && te && (en < ts || en > te)) e.push(`Period ${i + 1}: end is outside ${name}'s travel dates.`);
    });
    return e;
  }, [periods, tripStart, tripEnd, name]);

  const savedStatus = initial.length ? `${initial.length} personal period${initial.length > 1 ? 's' : ''}` : 'no personal days';

  return (
    <div className="rounded border border-[var(--ecs-border)] p-3">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={declares} onChange={(e) => toggle(e.target.checked)} disabled={disabled} className="w-4 h-4" />
        {name}
        <span className="text-xs font-normal text-[var(--ecs-muted)]">· {declares ? 'has personal days' : savedStatus}</span>
      </label>

      {declares && (
        <form action={action} className="mt-3 space-y-2">
          <input type="hidden" name="personalPeriodsJson" value={JSON.stringify(periods.filter((p) => p.start && p.end))} />
          {periods.map((p, i) => (
            <div key={i} className="grid md:grid-cols-[1fr_1fr_2fr_auto] gap-2 items-end">
              <div>
                <label className="text-[11px] text-[var(--ecs-muted)]">From</label>
                <input type="date" value={p.start} min={tripStart || undefined} max={tripEnd || undefined} onChange={(e) => set(i, { start: e.target.value })} disabled={disabled} className="field" />
              </div>
              <div>
                <label className="text-[11px] text-[var(--ecs-muted)]">To</label>
                <input type="date" value={p.end} min={p.start || tripStart || undefined} max={tripEnd || undefined} onChange={(e) => set(i, { end: e.target.value })} disabled={disabled} className="field" />
              </div>
              <div>
                <label className="text-[11px] text-[var(--ecs-muted)]">Note (optional)</label>
                <input type="text" value={p.note ?? ''} onChange={(e) => set(i, { note: e.target.value })} disabled={disabled} className="field" placeholder="e.g. personal days after the event" />
              </div>
              {!disabled && <button type="button" onClick={() => remove(i)} aria-label="Remove" className="h-[38px] px-3 rounded border border-[var(--ecs-border)] text-[var(--ecs-muted)] hover:text-[var(--ecs-red)] hover:border-[var(--ecs-red)]">✕</button>}
            </div>
          ))}
          {errors.length > 0 && <ul className="text-[12px] text-red-700 list-disc pl-4">{errors.map((x, i) => <li key={i}>{x}</li>)}</ul>}
          <div className="flex items-center gap-2 pt-1">
            {!disabled && <button type="button" onClick={add} className="btn-secondary text-xs">＋ Add personal days</button>}
            {!disabled && <button type="submit" disabled={errors.length > 0} className="btn-primary text-xs disabled:opacity-50">Save {name.split(' ').slice(-1)[0]}&apos;s personal days</button>}
          </div>
        </form>
      )}

      {!declares && initial.length > 0 && !disabled && (
        <form action={action} className="mt-2">
          <input type="hidden" name="personalPeriodsJson" value="[]" />
          <button className="btn-ghost text-xs">Clear personal days</button>
        </form>
      )}
    </div>
  );
}

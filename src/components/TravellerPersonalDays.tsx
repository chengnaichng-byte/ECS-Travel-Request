'use client';
// §4.5/§13.20 Per-traveller personal days for a GROUP member. Each staff / student member declares
// their OWN personal day ranges (before / during / after the business portion), independent of the
// others — there is no group-wide personal extension. Its own form + Save (the per-member rows cannot
// nest inside the main trip form), posting the declared periods for this member only.
import { useMemo, useState } from 'react';
import { type PersonalPeriod } from '@/modules/pretrip/personal';

const toD = (s: string) => (s ? new Date(`${s}T00:00:00Z`) : null);

export function TravellerPersonalDays({ name, subtitle, tripStart, tripEnd, initial, disabled, action }: {
  name: string;
  subtitle?: string;
  tripStart: string;    // the member's effective window (ISO), for min/max + validation
  tripEnd: string;
  initial: PersonalPeriod[];
  disabled?: boolean;
  action: (fd: FormData) => void | Promise<void>;
}) {
  const [periods, setPeriods] = useState<PersonalPeriod[]>(initial);
  const add = () => setPeriods((ps) => [...ps, { start: tripStart || '', end: tripEnd || '' }]);
  const set = (i: number, patch: Partial<PersonalPeriod>) => setPeriods((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const remove = (i: number) => setPeriods((ps) => ps.filter((_, j) => j !== i));

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

  return (
    <form action={action} className="rounded-lg border border-[var(--ecs-border)] p-3">
      <input type="hidden" name="personalPeriodsJson" value={JSON.stringify(periods.filter((p) => p.start && p.end))} />
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-[var(--ecs-navy)]">{name}</div>
          {subtitle && <div className="text-[11px] text-[var(--ecs-muted)]">{subtitle}</div>}
        </div>
        {!disabled && <button type="button" onClick={add} className="text-sm font-medium text-[var(--ecs-navy)] hover:underline shrink-0">+ Add personal days</button>}
      </div>

      {periods.length === 0 ? (
        <p className="text-sm text-[var(--ecs-muted)] mt-2 italic">No personal days — all official business.</p>
      ) : (
        <div className="mt-2 space-y-2">
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
        </div>
      )}

      {errors.length > 0 && <ul className="mt-2 text-[12px] text-red-700 list-disc pl-4">{errors.map((x, i) => <li key={i}>{x}</li>)}</ul>}

      {!disabled && (
        <div className="mt-3">
          <button type="submit" disabled={errors.length > 0} className="px-3 py-1.5 rounded bg-[var(--ecs-navy)] text-white text-sm font-medium disabled:opacity-50">Save {name.split(' ').slice(-1)[0]}&apos;s personal days</button>
        </div>
      )}
    </form>
  );
}

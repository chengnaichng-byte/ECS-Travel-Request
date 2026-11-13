'use client';
// §4.5 Claim personal-period editor — the traveller declares the ACTUAL personal extension(s) within the
// trip as date ranges, each with a LOCATION (ODA / accommodation rates differ by place, so the exclusion
// is attributed to that city's line). Personal DAYS (ODA) and personal NIGHTS (accommodation) derive from
// these, so the two can never disagree. Supports several extensions (a mid-trip break AND a tail extension)
// via Add. Lives inside the funded-basis <form>; it renders the hidden periodCount + period_<i>_* inputs
// the save action reads, and saving recomputes the funded amounts, the ODA/accommodation claim lines, and
// the header personal-day count. Read-only when the claim can't be edited.
import { useState } from 'react';

type City = { code: string; name: string };
type Row = { start: string; end: string; location?: string };

export function PersonalPeriodsEditor({ initial, cities, canEdit }: { initial: Row[]; cities: City[]; canEdit: boolean }) {
  const [rows, setRows] = useState<Row[]>(initial.length ? initial : [{ start: '', end: '', location: cities[0]?.code }]);
  const set = (i: number, k: keyof Row, v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const add = () => setRows((rs) => [...rs, { start: '', end: '', location: cities[0]?.code }]);
  const remove = (i: number) => setRows((rs) => (rs.length <= 1 ? [{ start: '', end: '', location: cities[0]?.code }] : rs.filter((_, j) => j !== i)));
  const cityName = (code?: string) => cities.find((c) => c.code === code)?.name ?? code ?? 'Anywhere';

  if (!canEdit) {
    const real = initial.filter((r) => r.start && r.end);
    return (
      <div className="text-sm">
        <div className="font-medium text-[var(--ecs-navy)] mb-1">Personal extension(s)</div>
        {real.length === 0 ? <span className="text-[var(--ecs-muted)]">None declared.</span> : (
          <ul className="space-y-1">{real.map((r, i) => <li key={i} className="text-[var(--ecs-muted)]">{r.start} → {r.end}{r.location ? ` · ${cityName(r.location)}` : ''}</li>)}</ul>
        )}
      </div>
    );
  }

  const inp = 'px-2 py-1 border border-[var(--ecs-border)] rounded bg-white text-sm outline-none focus:border-[var(--ecs-navy)]';
  return (
    <div>
      <div className="text-sm font-medium text-[var(--ecs-navy)] mb-2">Personal extension(s) within the trip <span className="font-normal text-[var(--ecs-muted)]">— personal days / nights derive from these</span></div>
      <input type="hidden" name="periodCount" value={rows.length} />
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--ecs-muted)] w-10">From</span>
            <input type="date" name={`period_${i}_start`} value={r.start} onChange={(e) => set(i, 'start', e.target.value)} className={inp} />
            <span className="text-xs text-[var(--ecs-muted)]">to</span>
            <input type="date" name={`period_${i}_end`} value={r.end} onChange={(e) => set(i, 'end', e.target.value)} className={inp} />
            <span className="text-xs text-[var(--ecs-muted)] ml-1">in</span>
            <select name={`period_${i}_location`} value={r.location ?? ''} onChange={(e) => set(i, 'location', e.target.value)} className={inp} title="Where the personal time was spent — the matching city's ODA / accommodation rate is excluded">
              <option value="">Anywhere</option>
              {cities.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
            <button type="button" onClick={() => remove(i)} title="Remove this extension" className="text-[var(--ecs-red)] hover:bg-red-50 rounded px-1.5 py-0.5 text-sm">✕</button>
          </div>
        ))}
      </div>
      <button type="button" onClick={add} className="mt-2 text-sm text-[var(--ecs-navy)] hover:underline">+ Add personal extension</button>
    </div>
  );
}

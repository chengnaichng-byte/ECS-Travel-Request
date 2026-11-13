'use client';
// §4.5 Claim personal-period editor — the traveller declares the ACTUAL personal extension(s) within the
// trip as date ranges. The LOCATION is auto-matched from the ODA/accommodation stays (the exclusion is
// attributed to whichever city's stay the dates fall in — ODA/accommodation rates differ by place), so
// the traveller enters dates only. Personal DAYS (ODA) and NIGHTS (accommodation) derive from these, so
// the two can never disagree. Supports several extensions (a mid-trip break AND a tail extension) via Add.
// Lives inside the funded-basis <form>; it renders the hidden periodCount + period_<i>_* inputs the save
// action reads, and saving recomputes the funded amounts, the ODA/accommodation claim lines, and the
// header personal-day count. Read-only when the claim can't be edited.
import { useState } from 'react';

type Stop = { city: string; from: string; to: string };
type Row = { start: string; end: string };

export function PersonalPeriodsEditor({ initial, stops, canEdit }: { initial: Row[]; stops: Stop[]; canEdit: boolean }) {
  const [rows, setRows] = useState<Row[]>(initial.length ? initial : [{ start: '', end: '' }]);
  const set = (i: number, k: keyof Row, v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const add = () => setRows((rs) => [...rs, { start: '', end: '' }]);
  const remove = (i: number) => setRows((rs) => (rs.length <= 1 ? [{ start: '', end: '' }] : rs.filter((_, j) => j !== i)));
  // ISO YYYY-MM-DD strings compare chronologically, so date-overlap is a plain string comparison.
  const matchCity = (r: Row): string | null => {
    if (!r.start || !r.end) return null;
    return stops.find((s) => r.start <= s.to && r.end >= s.from)?.city ?? null;
  };

  if (!canEdit) {
    const real = initial.filter((r) => r.start && r.end);
    return (
      <div className="text-sm">
        <div className="font-medium text-[var(--ecs-navy)] mb-1">Personal extension(s)</div>
        {real.length === 0 ? <span className="text-[var(--ecs-muted)]">None declared.</span> : (
          <ul className="space-y-1">{real.map((r, i) => { const c = matchCity(r); return <li key={i} className="text-[var(--ecs-muted)]">{r.start} → {r.end}{c ? ` · ${c}` : ''}</li>; })}</ul>
        )}
      </div>
    );
  }

  const inp = 'px-2 py-1 border border-[var(--ecs-border)] rounded bg-white text-sm outline-none focus:border-[var(--ecs-navy)]';
  return (
    <div>
      <div className="text-sm font-medium text-[var(--ecs-navy)] mb-2">Personal extension(s) within the trip <span className="font-normal text-[var(--ecs-muted)]">— dates only; the city is matched from the stays below</span></div>
      <input type="hidden" name="periodCount" value={rows.length} />
      <div className="space-y-2">
        {rows.map((r, i) => { const city = matchCity(r); return (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--ecs-muted)] w-10">From</span>
            <input type="date" name={`period_${i}_start`} value={r.start} onChange={(e) => set(i, 'start', e.target.value)} className={inp} />
            <span className="text-xs text-[var(--ecs-muted)]">to</span>
            <input type="date" name={`period_${i}_end`} value={r.end} onChange={(e) => set(i, 'end', e.target.value)} className={inp} />
            {r.start && r.end && (city
              ? <span className="text-[11px] txt-derived ml-1">→ matched to <b>{city}</b></span>
              : <span className="text-[11px] text-amber-700 ml-1">→ outside any stay — check the dates</span>)}
            <button type="button" onClick={() => remove(i)} title="Remove this extension" className="ml-auto text-[var(--ecs-red)] hover:bg-red-50 rounded px-1.5 py-0.5 text-sm">✕</button>
          </div>
        ); })}
      </div>
      <button type="button" onClick={add} className="mt-2 text-sm text-[var(--ecs-navy)] hover:underline">+ Add personal extension</button>
    </div>
  );
}

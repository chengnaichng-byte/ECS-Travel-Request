'use client';
// The per-city ODA / per-stay accommodation breakdown — SHARED by the read-only View modal and (as an
// editable variant) the Edit modal. These rows are the CLAIMABLE segments only: the declared personal
// days/nights are carved out of the booked stay before it reaches here, so every row is fully claimable
// (Amount = nights/days × rate). A personal break in the middle of a stay appears as two rows. There is
// therefore no "personal" or "funded" column — what you see is what is claimed.
import type { ReactNode } from 'react';

// Where a stay row's dates came from — the feed never supplies hotel dates, so they are either inferred
// from the booked flight itinerary, defaulted from the approved estimate, or confirmed/edited by the claimant.
export type StaySrc = 'flights' | 'estimate' | 'edited';
export interface OdaRow { country: string; city: string; arrive: string; depart: string; stay: number; rate: number; amount: number; src?: StaySrc }
export interface AccomRow { country: string; city: string; checkIn: string; checkOut: string; nights: number; rate: number; amount: number; src?: StaySrc }

const fmt = (n: number) => n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SRC_META: Record<StaySrc, { t: string; bg: string; fg: string; b: string }> = {
  flights: { t: 'from flights', bg: '#eef5fc', fg: '#185fa5', b: '#9cc3e6' },
  estimate: { t: 'from estimate', bg: '#f1f1f6', fg: '#555', b: '#dddde3' },
  edited: { t: 'you confirmed', bg: '#e1f5ee', fg: '#0f6e56', b: '#a7dcc6' },
};
// Small badge showing a stay row's date provenance (flights / estimate / edited).
export function SourceChip({ src }: { src?: StaySrc }) {
  if (!src) return null;
  const m = SRC_META[src];
  return <span className="inline-block rounded px-1 py-0.5 text-[9px] font-semibold tracking-wide whitespace-nowrap" style={{ background: m.bg, color: m.fg, border: `1px solid ${m.b}` }}>{m.t}</span>;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="text-xs font-semibold text-[var(--ecs-muted)] uppercase tracking-wide mb-1">{children}</div>;
}

// The ODA per-city table — claimable days only.
export function OdaTable({ oda }: { oda: OdaRow[] }) {
  return (
    <div>
      <SectionLabel>Overseas Daily Allowance — claimable days <span className="font-normal normal-case text-[#0f6e56]">· personal days excluded</span></SectionLabel>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr>
            <th className="th">Destination Country/Region</th><th className="th">City</th><th className="th">From</th><th className="th">To</th>
            <th className="th text-right">Claimable days</th><th className="th text-right">ODA Rate</th><th className="th text-right">Amount (SGD)</th>
          </tr></thead>
          <tbody>
            {oda.map((o, i) => (
              <tr key={i}>
                <td className="td whitespace-nowrap">{o.country} <SourceChip src={o.src} /></td><td className="td">{o.city}</td><td className="td whitespace-nowrap">{o.arrive}</td><td className="td whitespace-nowrap">{o.depart}</td>
                <td className="td text-right whitespace-nowrap font-medium">{o.stay} day{o.stay === 1 ? '' : 's'}</td>
                <td className="td text-right text-[var(--ecs-muted)]">{fmt(o.rate)}</td><td className="td text-right">{fmt(o.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// The accommodation per-stay table — claimable nights only.
export function AccomTable({ accom }: { accom: AccomRow[] }) {
  return (
    <div>
      <SectionLabel>Accommodation — claimable nights <span className="font-normal normal-case text-[#0f6e56]">· personal nights excluded</span></SectionLabel>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr>
            <th className="th">Destination Country/Region</th><th className="th">City</th><th className="th">Check In Date</th><th className="th">Check Out Date</th>
            <th className="th text-right">Claimable nights</th><th className="th text-right">Amount (SGD)</th><th className="th text-right">Avg rate/night (SGD)</th>
          </tr></thead>
          <tbody>
            {accom.map((a, i) => (
              <tr key={i}>
                <td className="td whitespace-nowrap">{a.country} <SourceChip src={a.src} /></td><td className="td">{a.city}</td><td className="td whitespace-nowrap">{a.checkIn}</td><td className="td whitespace-nowrap">{a.checkOut}</td>
                <td className="td text-right whitespace-nowrap font-medium">{a.nights} night{a.nights === 1 ? '' : 's'}</td>
                <td className="td text-right">{fmt(a.amount)}</td><td className="td text-right text-[var(--ecs-muted)]">{fmt(a.rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Both tables together (whichever is present). Used by the View modal.
export function StayBreakdown({ oda, accom }: { oda?: OdaRow[]; accom?: AccomRow[] }) {
  if (!(oda && oda.length) && !(accom && accom.length)) return null;
  return (
    <div className="space-y-4">
      {oda && oda.length > 0 && <OdaTable oda={oda} />}
      {accom && accom.length > 0 && <AccomTable accom={accom} />}
    </div>
  );
}

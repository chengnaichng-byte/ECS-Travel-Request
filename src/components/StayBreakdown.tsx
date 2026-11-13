'use client';
// The per-city ODA / per-stay accommodation breakdown — SHARED by the read-only View modal and the
// editable Edit modal so both show exactly the same datapoints and layout (ECS columns + the NEW
// personal / funded split). The stay DATES and NIGHTS come from the approved TR estimate and the actual
// TMC feed; the personal / funded split is the pre-trip addition (tinted green, tagged NEW). The nightly
// rate × funded nights is what drives the funded amount — making the Amount explainable instead of a
// bare lump sum. Read-only here: the stay / personal / rate are edited in the claim's "Funded basis" card.
import type { ReactNode } from 'react';

export interface OdaRow { country: string; city: string; arrive: string; depart: string; stay: number; personal: number; funded: number; rate: number; amount: number }
export interface AccomRow { country: string; city: string; checkIn: string; checkOut: string; nights: number; personal: number; funded: number; rate: number; amount: number }

const fmt = (n: number) => n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const HI = '#f0faf5';
const HIBORDER = '#a7dcc6';
const NewTag = () => <span className="ml-1.5 inline-block rounded px-1 py-0.5 text-[9px] font-semibold tracking-wide align-middle" style={{ background: '#e1f5ee', color: '#0f6e56', border: `1px solid ${HIBORDER}` }}>NEW</span>;

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="text-xs font-semibold text-[var(--ecs-muted)] uppercase tracking-wide mb-1">{children}</div>;
}

// The ODA per-city table — ECS columns with the Personal / Funded split inserted.
export function OdaTable({ oda }: { oda: OdaRow[] }) {
  return (
    <div>
      <SectionLabel>Overseas Daily Allowance — per city <span className="font-normal normal-case text-[#0f6e56]">· funded (personal-excluded) split added</span></SectionLabel>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr>
            <th className="th">Destination Country/Region</th><th className="th">City</th><th className="th">Arrival Date</th><th className="th">Departure Date</th><th className="th text-right">Duration</th>
            <th className="th text-right" style={{ background: HI }}>Personal<NewTag /></th><th className="th text-right" style={{ background: HI }}>Funded days<NewTag /></th>
            <th className="th text-right">ODA Rate</th><th className="th text-right">Amount (SGD)</th>
          </tr></thead>
          <tbody>
            {oda.map((o, i) => (
              <tr key={i}>
                <td className="td">{o.country}</td><td className="td">{o.city}</td><td className="td whitespace-nowrap">{o.arrive}</td><td className="td whitespace-nowrap">{o.depart}</td>
                <td className="td text-right whitespace-nowrap">{o.stay} day{o.stay === 1 ? '' : 's'}</td>
                <td className={`td text-right ${o.personal > 0 ? 'font-medium text-amber-700' : 'text-[var(--ecs-muted)]'}`} style={{ background: HI }}>{o.personal}</td>
                <td className="td text-right font-medium" style={{ background: HI }}>{o.funded}</td>
                <td className="td text-right text-[var(--ecs-muted)]">{fmt(o.rate)}</td><td className="td text-right">{fmt(o.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// The accommodation per-stay table — ECS columns with the Personal / Funded nights split inserted.
export function AccomTable({ accom }: { accom: AccomRow[] }) {
  return (
    <div>
      <SectionLabel>Accommodation — per stay <span className="font-normal normal-case text-[#0f6e56]">· funded (personal-excluded) split added</span></SectionLabel>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr>
            <th className="th">Destination Country/Region</th><th className="th">City</th><th className="th">Check In Date</th><th className="th">Check Out Date</th><th className="th text-right">Duration</th>
            <th className="th text-right" style={{ background: HI }}>Personal<NewTag /></th><th className="th text-right" style={{ background: HI }}>Funded nights<NewTag /></th>
            <th className="th text-right">Amount (SGD)</th><th className="th text-right">Avg rate/night (SGD)</th>
          </tr></thead>
          <tbody>
            {accom.map((a, i) => (
              <tr key={i}>
                <td className="td">{a.country}</td><td className="td">{a.city}</td><td className="td whitespace-nowrap">{a.checkIn}</td><td className="td whitespace-nowrap">{a.checkOut}</td>
                <td className="td text-right whitespace-nowrap">{a.nights} night{a.nights === 1 ? '' : 's'}</td>
                <td className={`td text-right ${a.personal > 0 ? 'font-medium text-amber-700' : 'text-[var(--ecs-muted)]'}`} style={{ background: HI }}>{a.personal}</td>
                <td className="td text-right font-medium" style={{ background: HI }}>{a.funded}</td>
                <td className="td text-right">{fmt(a.amount)}</td><td className="td text-right text-[var(--ecs-muted)]">{fmt(a.rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Both tables together (whichever is present). Used by the View modal (read-only context) and the Edit
// modal (the stay sub-block that makes the pre-filled dates / nights visible while the actual is entered).
export function StayBreakdown({ oda, accom }: { oda?: OdaRow[]; accom?: AccomRow[] }) {
  if (!(oda && oda.length) && !(accom && accom.length)) return null;
  return (
    <div className="space-y-4">
      {oda && oda.length > 0 && <OdaTable oda={oda} />}
      {accom && accom.length > 0 && <AccomTable accom={accom} />}
    </div>
  );
}

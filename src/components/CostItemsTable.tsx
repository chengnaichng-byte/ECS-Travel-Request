'use client';
// F. Estimated Travel Cost Items — rows expand to reveal how each amount is computed
// (cap, nights, rate, eligible days, quoted vs budgeted, cap variance). For group
// requests a row expands to the per-traveller / per-line breakdown.
import { Fragment, useState } from 'react';
import { fmtSgd } from '@/modules/pretrip/pricing';

export interface BreakLine { heading: string; computation: string; kv: [string, string][] }
export interface CostRow {
  typeName: string; detail: string; basis: string;
  gross: number; sponsor: number; ntu: number;
  outcomeExc: boolean; outcomeLabel: string;
  breakdown: BreakLine[];
}
export interface SummaryRow { label: string; value: number; strong?: boolean; paren?: boolean; divider?: boolean }

export function CostItemsTable({ rows, group, summaryRows = [] }: { rows: CostRow[]; group: boolean; summaryRows?: SummaryRow[] }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const totals = rows.reduce((a, r) => ({ g: a.g + r.gross, s: a.s + r.sponsor, n: a.n + r.ntu }), { g: 0, s: 0, n: 0 });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr>
          <th className="th w-8"></th><th className="th">#</th><th className="th">Expense Type</th><th className="th">Details / Itinerary</th><th className="th">Basis</th>
          <th className="th text-right">Gross Estimate</th><th className="th text-right">Sponsorship / Personal</th><th className="th text-right">NTU-funded</th><th className="th">Policy Outcome</th>
        </tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <Fragment key={i}>
              <tr className="hover:bg-[var(--ecs-panel-2)] cursor-pointer" onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}>
                <td className="td text-[var(--ecs-muted)] text-center">{open[i] ? '▾' : '▸'}</td>
                <td className="td">{i + 1}</td>
                <td className="td font-medium">{r.typeName}</td>
                <td className="td text-xs text-[var(--ecs-muted)]">{r.detail}</td>
                <td className="td text-xs">{r.basis}</td>
                <td className="td text-right whitespace-nowrap">{fmtSgd(r.gross)}</td>
                <td className="td text-right whitespace-nowrap">{r.sponsor ? `(${fmtSgd(r.sponsor)})` : fmtSgd(0)}</td>
                <td className="td text-right whitespace-nowrap">{fmtSgd(r.ntu)}</td>
                <td className="td"><span className={r.outcomeExc ? 'pill-exc' : 'pill-pass'}>{r.outcomeLabel}</span></td>
              </tr>
              {open[i] && (
                <tr className="bg-[var(--ecs-panel-2)]">
                  <td className="td"></td>
                  <td className="td" colSpan={8}>
                    <div className="grid md:grid-cols-2 gap-3 py-1">
                      {r.breakdown.map((b, j) => (
                        <div key={j} className="bg-white border border-[var(--ecs-border)] rounded p-3">
                          <div className="text-xs font-semibold text-[var(--ecs-navy)] mb-1">{b.heading}</div>
                          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-2">
                            {b.kv.map(([k, v], m) => (
                              <div key={m} className="flex justify-between gap-2"><dt className="text-[var(--ecs-muted)]">{k}</dt><dd className="text-right whitespace-nowrap">{v}</dd></div>
                            ))}
                          </dl>
                          <div className="text-xs italic text-[var(--ecs-muted)]">{b.computation}</div>
                        </div>
                      ))}
                    </div>
                    {group && <div className="text-[11px] text-[var(--ecs-muted)] pb-1">Per-traveller lines shown; shared accommodation apportions each traveller&apos;s own nights (§13.20).</div>}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold text-[var(--ecs-navy)]">
            <td className="td"></td><td className="td" colSpan={4}>Total</td>
            <td className="td text-right">{fmtSgd(totals.g)}</td>
            <td className="td text-right">{totals.s ? `(${fmtSgd(totals.s)})` : fmtSgd(0)}</td>
            <td className="td text-right">{fmtSgd(totals.n)}</td>
            <td className="td"></td>
          </tr>
          {summaryRows.map((s, i) => (
            <tr key={i} className={s.strong ? 'font-semibold text-[var(--ecs-navy)]' : 'text-[var(--ecs-muted)]'}>
              <td className={`td text-right ${s.divider ? 'border-t border-[var(--ecs-border)]' : 'border-0'}`} colSpan={5}>{s.label}</td>
              <td className={`td text-right whitespace-nowrap ${s.divider ? 'border-t border-[var(--ecs-border)]' : 'border-0'} ${s.strong ? 'text-[var(--ecs-navy)]' : 'text-[var(--ecs-text)]'}`}>
                {s.paren ? `(${fmtSgd(s.value)})` : fmtSgd(s.value)}
              </td>
              <td className={`td ${s.divider ? 'border-t border-[var(--ecs-border)]' : 'border-0'}`} colSpan={3}></td>
            </tr>
          ))}
        </tfoot>
      </table>
    </div>
  );
}

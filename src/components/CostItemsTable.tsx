'use client';
// F. Estimated Travel Cost Items — rows expand to reveal how each amount is computed
// (cap, nights, rate, eligible days, quoted vs budgeted, cap variance). For group
// requests a row expands to the per-traveller / per-line breakdown.
import { Fragment, useState } from 'react';
import { fmtSgd } from '@/modules/pretrip/pricing';

export type BreakField = [string, string] | [string, string, string]; // [label, value, caption?]
export interface BreakGroup { title: string; fields: BreakField[] }
export interface BreakLine { heading: string; total?: number; computation: string; groups: BreakGroup[]; actions?: React.ReactNode }
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
                    <div className="grid gap-3 py-1">
                      {r.breakdown.map((b, j) => (
                        <div key={j} className="bg-white border border-[var(--ecs-border)] rounded-lg p-3.5">
                          {/* header — who/where on the left, the line total on the right */}
                          <div className="flex items-center justify-between gap-3 border-b border-[var(--ecs-border)] pb-2 mb-2.5">
                            <span className="text-sm font-semibold text-[var(--ecs-navy)]">{b.heading}</span>
                            <div className="flex items-center gap-3">
                              {b.actions}
                              {b.total != null && <span className="text-sm font-semibold text-[var(--ecs-navy)] whitespace-nowrap">{fmtSgd(b.total)}</span>}
                            </div>
                          </div>
                          {/* two labelled groups — e.g. Stay | Rate */}
                          <div className="grid sm:grid-cols-2 gap-x-10 gap-y-3">
                            {b.groups.map((g, gi) => (
                              <div key={gi}>
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ecs-muted)] mb-1.5">{g.title}</div>
                                <dl className="space-y-1.5">
                                  {g.fields.map((f, fi) => (
                                    <div key={fi} className="flex items-baseline justify-between gap-4 text-xs">
                                      <dt className="text-[var(--ecs-muted)] shrink-0">{f[0]}</dt>
                                      <dd className="text-right">
                                        <span className="font-medium text-[var(--ecs-text)]">{f[1]}</span>
                                        {f[2] && <div className="text-[10px] font-normal text-[var(--ecs-muted)] leading-tight">{f[2]}</div>}
                                      </dd>
                                    </div>
                                  ))}
                                </dl>
                              </div>
                            ))}
                          </div>
                          <div className="text-[11px] italic text-[var(--ecs-muted)] mt-3 pt-2 border-t border-[var(--ecs-border)]">{b.computation}</div>
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
          {summaryRows.map((s, i) => {
            const bt = s.divider ? 'border-t border-[var(--ecs-border)]' : 'border-0';
            return (
              <tr key={i} className={s.strong ? 'font-semibold text-[var(--ecs-navy)]' : 'text-[var(--ecs-muted)]'}>
                {/* Figures stack in the right-most money (NTU-funded) column, aligned with the Total. */}
                <td className={`td text-right ${bt}`} colSpan={7}>{s.label}</td>
                <td className={`td text-right whitespace-nowrap ${bt} ${s.strong ? 'text-[var(--ecs-navy)]' : 'text-[var(--ecs-text)]'}`}>
                  {s.paren ? `(${fmtSgd(s.value)})` : fmtSgd(s.value)}
                </td>
                <td className={`td ${bt}`}></td>
              </tr>
            );
          })}
        </tfoot>
      </table>
    </div>
  );
}

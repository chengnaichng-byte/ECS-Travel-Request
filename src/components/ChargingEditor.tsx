'use client';
// §17 Charging & Cost Allocation editor (client) — ECS-consistent experience.
// Lets the user cross-charge a trip either as one whole-request split OR per cost line,
// and shows the computed cost allocation per charging account live as they edit. The
// effective split is submitted to the saveCharging server action, which persists both the
// per-line assignment and the normalised ChargingAllocation rows that drive approval routing.
import { useMemo, useState } from 'react';
import { rollupByCode, rollupRequestRows, type RollupRow } from '@/modules/pretrip/chargingRollup';

export interface CodeOption {
  code: string; name: string; type: string; deptName: string; ba: string;
  research: boolean; crossCharge: boolean; closed: boolean;
}
export interface CostLine { id: string; type: string; detail: string; netSgd: number; }
interface RequestRow { chargingCode: string; value: string; }

const fmt = (n: number) => 'SGD ' + n.toLocaleString('en-SG', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export function ChargingEditor({
  action, canEdit, amountMode, ntuFunded, codes, defaultCode,
  initialMode, lines, initialRequestRows, initialLineMap,
}: {
  action: (fd: FormData) => void;
  canEdit: boolean;
  amountMode: boolean;
  ntuFunded: number;
  codes: CodeOption[];
  defaultCode: string;
  initialMode: 'REQUEST' | 'LINE';
  lines: CostLine[];
  initialRequestRows: RequestRow[];
  initialLineMap: Record<string, string>;
}) {
  const [mode, setMode] = useState<'REQUEST' | 'LINE'>(initialMode);
  const [rows, setRows] = useState<RequestRow[]>(() => {
    const r = [...initialRequestRows];
    while (r.length < 5) r.push({ chargingCode: '', value: '' });
    // default the first row to the profile charging account on a fresh request
    if (initialRequestRows.length === 0) r[0] = { chargingCode: defaultCode, value: '' };
    return r.slice(0, 5);
  });
  const [lineMap, setLineMap] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const l of lines) m[l.id] = initialLineMap[l.id] ?? defaultCode;
    return m;
  });

  const codeOf = (c: string) => codes.find((x) => x.code === c);

  const rollup: RollupRow[] = useMemo(() => {
    if (mode === 'LINE') {
      return rollupByCode(lines.map((l) => ({ chargingCode: lineMap[l.id] || defaultCode, netSgd: l.netSgd })));
    }
    return rollupRequestRows(
      rows.map((r) => ({ chargingCode: r.chargingCode, percent: Number(r.value) || 0, amountSgd: Number(r.value) || 0 })),
      ntuFunded, amountMode,
    );
  }, [mode, rows, lineMap, lines, ntuFunded, amountMode, defaultCode]);

  const rollupTotalPct = rollup.reduce((s, r) => s + r.percent, 0);
  const rollupTotalAmt = rollup.reduce((s, r) => s + r.amountSgd, 0);
  const balanced = Math.abs(rollupTotalPct - 100) < 0.05;

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="chargingMode" value={mode} />

      <div className="card p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
          <h3 className="font-semibold text-[var(--ecs-navy)]">Charging &amp; Cost Allocation</h3>
          <fieldset className="flex items-center gap-4 text-sm" disabled={!canEdit}>
            <span className="text-[var(--ecs-muted)]">Allocate:</span>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="_mode" checked={mode === 'REQUEST'} onChange={() => setMode('REQUEST')} /> By travel request
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="_mode" checked={mode === 'LINE'} onChange={() => setMode('LINE')} /> By cost line (cross-charge)
            </label>
          </fieldset>
        </div>
        <p className="text-xs text-[var(--ecs-muted)] mb-4">
          {mode === 'REQUEST'
            ? 'One split applies to the whole estimated cost. The split must total 100%.'
            : 'Charge each cost line to a specific account to cross-charge across departments or grants. Lines left on the default account follow the traveller’s profile charging account.'}
          {' '}Research WBS drives the research approval route; the highest-share department derives the DOA (§13.14).
        </p>

        {mode === 'REQUEST' ? (
          <div className="space-y-3">
            {rows.map((row, i) => (
              <div key={i} className="grid grid-cols-[1fr_140px] gap-3 items-end">
                <div>
                  <label className="label">Charging code {i + 1}{i === 0 && <span className="text-[var(--ecs-muted)] font-normal"> · default from profile</span>}</label>
                  <select name={`code_${i}`} value={row.chargingCode} disabled={!canEdit}
                    onChange={(e) => setRows((rs) => rs.map((r, j) => j === i ? { ...r, chargingCode: e.target.value } : r))}
                    className="field">
                    <option value="">— none —</option>
                    {codes.map((c) => <option key={c.code} value={c.code} disabled={c.closed && row.chargingCode !== c.code}>{c.code} — {c.name}{c.research ? ' (research)' : ''}{c.closed ? ' — CLOSED' : ''}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">{amountMode ? 'Amount (SGD)' : 'Percent'}</label>
                  <input name={amountMode ? `amt_${i}` : `pct_${i}`} type="number" step="any" value={row.value} disabled={!canEdit}
                    onChange={(e) => setRows((rs) => rs.map((r, j) => j === i ? { ...r, value: e.target.value } : r))}
                    className="field" placeholder={amountMode ? 'SGD' : '%'} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>
                <th className="th">Cost line</th><th className="th">Detail</th>
                <th className="th text-right">Amount (SGD)</th><th className="th">Charge to account</th>
              </tr></thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr><td className="td text-[var(--ecs-muted)] italic" colSpan={4}>No cost lines yet — add estimates first.</td></tr>
                ) : lines.map((l) => (
                  <tr key={l.id} className="hover:bg-[var(--ecs-panel-2)]">
                    <td className="td font-medium whitespace-nowrap">{l.type}</td>
                    <td className="td text-xs text-[var(--ecs-muted)]">{l.detail}</td>
                    <td className="td text-right whitespace-nowrap">{fmt(l.netSgd)}</td>
                    <td className="td">
                      <select name={`line_${l.id}`} value={lineMap[l.id] ?? ''} disabled={!canEdit}
                        onChange={(e) => setLineMap((m) => ({ ...m, [l.id]: e.target.value }))}
                        className="field">
                        {codes.map((c) => <option key={c.code} value={c.code} disabled={c.closed && lineMap[l.id] !== c.code}>{c.code} — {c.name}{c.research ? ' (research)' : ''}{c.closed ? ' — CLOSED' : ''}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Computed cost allocation by charging account (live) */}
        <div className="mt-5 border-t border-[var(--ecs-border)] pt-4">
          <h4 className="text-sm font-semibold text-[var(--ecs-navy)] mb-2">Computed cost allocation by charging account</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead><tr>
                <th className="th">CC / WBS</th><th className="th">Charging account</th><th className="th">Type</th>
                <th className="th">Department · BA</th><th className="th text-right">Share</th><th className="th text-right">Amount (SGD)</th>
              </tr></thead>
              <tbody>
                {rollup.length === 0 ? (
                  <tr><td className="td text-[var(--ecs-muted)] italic" colSpan={6}>Nothing allocated yet.</td></tr>
                ) : rollup.map((r) => {
                  const c = codeOf(r.chargingCode);
                  return (
                    <tr key={r.chargingCode} className="hover:bg-[var(--ecs-panel-2)]">
                      <td className="td font-medium whitespace-nowrap">{r.chargingCode}
                        {c?.research && <span className="pill-warn ml-1">Research WBS</span>}
                        {c?.crossCharge && <span className="pill-info ml-1">Cross-charge</span>}
                      </td>
                      <td className="td">{c?.name ?? '—'}</td>
                      <td className="td">{c?.type ?? '—'}</td>
                      <td className="td whitespace-nowrap">{c?.deptName ?? '—'} · {c?.ba ?? '—'}</td>
                      <td className="td text-right">{r.percent}%</td>
                      <td className="td text-right whitespace-nowrap font-medium">{fmt(r.amountSgd)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-semibold text-[var(--ecs-navy)]">
                  <td className="td" colSpan={4}>Total {mode === 'REQUEST' ? '' : '(estimated NTU-funded cost)'}</td>
                  <td className={`td text-right ${balanced ? 'text-emerald-700' : 'text-amber-700'}`}>{Math.round(rollupTotalPct * 10) / 10}%</td>
                  <td className="td text-right whitespace-nowrap">{fmt(rollupTotalAmt)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {mode === 'REQUEST' && !balanced && <p className="text-xs text-amber-700 mt-2">Allocation must total 100% before the request can be submitted (AC06).</p>}
          {mode === 'LINE' && <p className="text-xs text-[var(--ecs-muted)] mt-2">Amounts aggregate each cost line’s NTU-funded amount onto its charging account; the effective percentage split is derived for approval routing.</p>}
        </div>
      </div>

      {canEdit && (
        <div className="flex justify-end">
          <button type="submit" className="btn-primary">Save &amp; run policy review →</button>
        </div>
      )}
    </form>
  );
}

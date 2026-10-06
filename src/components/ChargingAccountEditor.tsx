'use client';
// §17 ECS-format Charging & Cost Allocation editor (client), reused by the Travel Request
// charging step and the Create-TE form. Mirrors the ECS TE screen:
//  • Main charging account — 4-level cascade: Company Code → Business Area → CC/WBS → Account
//  • "Cost allocation required?" → Allocation at Claim/Item Level vs Allocation per Expense Item
//  • Accounting Entries — computed GL postings per (account × expense type), with the
//    main-charging-account flag and % of allocation.
// The effective split is submitted to the bound server action, which persists the canonical
// ChargingAllocation rows that drive approval routing (unchanged contract).
import { useMemo, useState } from 'react';

export interface AccountOpt { code: string; name: string; type: string; companyCode: string; businessArea: string; research: boolean; crossCharge: boolean; closed: boolean; }
export interface CompanyOpt { code: string; name: string; }
export interface BAOpt { code: string; name: string; companyCode: string; }
export interface ExpenseTypeOpt { id: string; name: string; gl: string; gst: string; }
export interface CostLineX {
  id: string; typeId: string; typeName: string; net: number;
  category: string;
  travellerName?: string;          // per-traveller attribution (group); undefined = requestor/shared
  isShared: boolean;               // §13.14 shared apportioned line
  deptAllocs: { code: string; pct: number }[];  // auto-by-department preset (traveller home dept CC × share)
  initialAllocs?: { code: string; pct: number; io: string }[]; // stored split, if any
}

interface ClaimRow { ba: string; code: string; io: string; pct: string; }
interface LineSplit { code: string; pct: string; io: string; }

const fmt = (n: number) => 'SGD ' + n.toLocaleString('en-SG', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/** Group cost lines by expense type (cost item) for a per-traveller breakdown with a subtotal. */
function groupByCategory(lines: CostLineX[]): { category: string; typeName: string; net: number; lines: CostLineX[] }[] {
  const order: string[] = [];
  const by = new Map<string, { category: string; typeName: string; net: number; lines: CostLineX[] }>();
  for (const l of lines) {
    const key = l.typeId;
    if (!by.has(key)) { by.set(key, { category: key, typeName: l.typeName, net: 0, lines: [] }); order.push(key); }
    const g = by.get(key)!; g.net += l.net; g.lines.push(l);
  }
  return order.map((k) => by.get(k)!);
}

export function ChargingAccountEditor({
  action, canEdit, total, companyCodes, businessAreas, accounts, expenseTypes, lines,
  defaultAccount, initialMode, initialMain, initialRows, initialLineMap, submitLabel = 'Save & run policy review →',
  entriesTitle = 'Accounting Entries',
}: {
  action: (fd: FormData) => void;
  canEdit: boolean;
  total: number;               // NTU-funded (TR) or total reimbursable (TE)
  companyCodes: CompanyOpt[];
  businessAreas: BAOpt[];
  accounts: AccountOpt[];
  expenseTypes: ExpenseTypeOpt[];
  lines: CostLineX[];
  defaultAccount: string;
  initialMode: 'MAIN' | 'CLAIM' | 'ITEM';
  initialMain: string;
  initialRows: { ba: string; code: string; io: string; pct: number }[];
  initialLineMap: Record<string, string>;
  submitLabel?: string;
  entriesTitle?: string;       // "Allocation Outcome" on the TR; "Accounting Entries" on the TE
}) {
  const acc = (c: string) => accounts.find((a) => a.code === c);
  const et = (id: string) => expenseTypes.find((e) => e.id === id);
  const mainCode0 = initialMain || defaultAccount || accounts[0]?.code || '';
  const main0 = acc(mainCode0);

  const [mode, setMode] = useState<'MAIN' | 'CLAIM' | 'ITEM'>(initialMode);
  const [main, setMain] = useState({
    company: main0?.companyCode ?? companyCodes[0]?.code ?? '',
    ba: main0?.businessArea ?? '',
    type: main0?.type ?? 'CC',
    code: mainCode0,
  });
  const [rows, setRows] = useState<ClaimRow[]>(() => {
    const seed = initialRows.length
      ? initialRows.map((r) => ({ ba: r.ba, code: r.code, io: r.io, pct: String(r.pct) }))
      : [{ ba: main0?.businessArea ?? '', code: mainCode0, io: '', pct: '100' }];
    return seed;
  });
  // §17 per-line splits (ITEM mode): each cost line carries one or more {account, %} rows.
  const [lineAllocs, setLineAllocs] = useState<Record<string, LineSplit[]>>(() => {
    const m: Record<string, LineSplit[]> = {};
    for (const l of lines) {
      m[l.id] = l.initialAllocs?.length
        ? l.initialAllocs.map((a) => ({ code: a.code, pct: String(a.pct), io: a.io || '' }))
        : [{ code: initialLineMap[l.id] ?? mainCode0, pct: '100', io: '' }];
    }
    return m;
  });
  const setLineRow = (lid: string, i: number, patch: Partial<LineSplit>) => setLineAllocs((m) => ({ ...m, [lid]: m[lid].map((r, j) => j === i ? { ...r, ...patch } : r) }));
  const addLineRow = (lid: string) => setLineAllocs((m) => ({ ...m, [lid]: [...m[lid], { code: '', pct: '', io: '' }] }));
  const delLineRow = (lid: string, i: number) => setLineAllocs((m) => ({ ...m, [lid]: m[lid].filter((_, j) => j !== i) }));
  const autoDept = (l: CostLineX) => setLineAllocs((m) => ({ ...m, [l.id]: (l.deptAllocs.length ? l.deptAllocs : [{ code: mainCode0, pct: 100 }]).map((a) => ({ code: a.code, pct: String(a.pct), io: '' })) }));
  const autoDeptAll = () => setLineAllocs((m) => { const next = { ...m }; for (const l of lines) if (l.deptAllocs.length) next[l.id] = l.deptAllocs.map((a) => ({ code: a.code, pct: String(a.pct), io: '' })); return next; });
  const lineBalanced = (lid: string) => Math.abs((lineAllocs[lid] ?? []).reduce((s, r) => s + (Number(r.pct) || 0), 0) - 100) < 0.05;
  const anyDeptPreset = lines.some((l) => l.deptAllocs.length > 0);

  const allocReq = mode !== 'MAIN';
  const baOptions = businessAreas.filter((b) => b.companyCode === main.company);
  const accForMain = accounts.filter((a) => a.companyCode === main.company && a.businessArea === main.ba && a.type === main.type);
  const accForBA = (ba: string) => accounts.filter((a) => a.companyCode === main.company && a.businessArea === ba);

  // Effective split → [{code, percent, amount, io, isMain}] used for routing preview + entries.
  const effective = useMemo(() => {
    if (mode === 'ITEM') {
      const byCode = new Map<string, number>();
      for (const l of lines) for (const a of (lineAllocs[l.id] ?? [])) { if (a.code) byCode.set(a.code, (byCode.get(a.code) ?? 0) + l.net * ((Number(a.pct) || 0) / 100)); }
      const tot = [...byCode.values()].reduce((s, v) => s + v, 0) || 1;
      return [...byCode.entries()].map(([code, amt]) => ({ code, amount: Math.round(amt * 100) / 100, percent: Math.round((amt / tot) * 1000) / 10, io: '', isMain: code === main.code }));
    }
    if (mode === 'CLAIM') {
      return rows.filter((r) => r.code).map((r) => ({ code: r.code, percent: Number(r.pct) || 0, amount: Math.round(((Number(r.pct) || 0) / 100) * total * 100) / 100, io: r.io, isMain: r.code === main.code }));
    }
    return main.code ? [{ code: main.code, percent: 100, amount: total, io: '', isMain: true }] : [];
  }, [mode, rows, lineAllocs, lines, total, main.code]);

  // Accounting Entries — per (account × expense type).
  const entries = useMemo(() => {
    const netByType = new Map<string, number>();
    for (const l of lines) netByType.set(l.typeId, (netByType.get(l.typeId) ?? 0) + l.net);
    const out: { code: string; typeId: string; amount: number; percent: number; io: string; isMain: boolean }[] = [];
    if (mode === 'ITEM') {
      const map = new Map<string, number>();
      for (const l of lines) for (const a of (lineAllocs[l.id] ?? [])) { if (!a.code) continue; const amt = l.net * ((Number(a.pct) || 0) / 100); map.set(`${a.code}|${l.typeId}`, (map.get(`${a.code}|${l.typeId}`) ?? 0) + amt); }
      const share = Object.fromEntries(effective.map((e) => [e.code, e.percent]));
      for (const [key, amt] of map) { const [code, typeId] = key.split('|'); if (amt > 0.005) out.push({ code, typeId, amount: Math.round(amt * 100) / 100, percent: share[code] ?? 0, io: '', isMain: code === main.code }); }
    } else {
      for (const e of effective) for (const [typeId, net] of netByType) {
        const amt = Math.round(net * (e.percent / 100) * 100) / 100;
        if (amt > 0.005) out.push({ code: e.code, typeId, amount: amt, percent: e.percent, io: e.io, isMain: e.isMain });
      }
    }
    return out.sort((a, b) => a.code.localeCompare(b.code) || a.typeId.localeCompare(b.typeId));
  }, [mode, effective, lines, lineAllocs, main.code]);

  const totalPct = effective.reduce((s, e) => s + e.percent, 0);
  const balanced = Math.abs(totalPct - 100) < 0.05;
  const entriesTotal = entries.reduce((s, e) => s + e.amount, 0);

  const setRow = (i: number, patch: Partial<ClaimRow>) => setRows((rs) => rs.map((r, j) => j === i ? { ...r, ...patch } : r));
  const addRow = () => setRows((rs) => [...rs, { ba: baOptions[0]?.code ?? '', code: '', io: '', pct: '' }]);
  const delRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  const AccountSelect = ({ value, opts, onChange, name }: { value: string; opts: AccountOpt[]; onChange: (v: string) => void; name?: string }) => (
    <select name={name} value={value} disabled={!canEdit} onChange={(e) => onChange(e.target.value)} className="field">
      <option value="">Select…</option>
      {opts.map((a) => <option key={a.code} value={a.code} disabled={a.closed && value !== a.code}>({a.code}) {a.name}{a.research ? ' · research' : ''}{a.closed ? ' — CLOSED' : ''}</option>)}
    </select>
  );

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="chargingMode" value={mode} />
      <input type="hidden" name="mainCode" value={main.code} />
      {mode === 'CLAIM' && rows.filter((r) => r.code).map((r, i) => (
        <span key={i} className="hidden">
          <input type="hidden" name={`row_code_${i}`} value={r.code} />
          <input type="hidden" name={`row_io_${i}`} value={r.io} />
          <input type="hidden" name={`row_pct_${i}`} value={r.pct} />
        </span>
      ))}
      {mode === 'ITEM' && lines.map((l) => <input key={l.id} type="hidden" name={`line_${l.id}_allocs`} value={JSON.stringify((lineAllocs[l.id] ?? []).filter((r) => r.code && Number(r.pct) > 0).map((r) => ({ code: r.code, pct: Number(r.pct) || 0, io: r.io })))} />)}

      {/* Main charging account — 4-level cascade */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-[var(--ecs-navy)]">Charging account details</h3>
        </div>
        <p className="text-xs text-[var(--ecs-muted)] mb-4">Main charging account — defaults to the traveller’s profile cost object. Research WBS drives the research route; the highest-share department derives the DOA (§13.14).</p>
        <div className="grid md:grid-cols-4 gap-4">
          <div>
            <label className="label">Company Code</label>
            <select className="field" disabled={!canEdit} value={main.company} onChange={(e) => setMain((m) => ({ ...m, company: e.target.value, ba: '', code: '' }))}>
              {companyCodes.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Business Area</label>
            <select className="field" disabled={!canEdit} value={main.ba} onChange={(e) => setMain((m) => ({ ...m, ba: e.target.value, code: '' }))}>
              <option value="">Select…</option>
              {baOptions.map((b) => <option key={b.code} value={b.code}>({b.code}) {b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">CC/WBS</label>
            <select className="field" disabled={!canEdit} value={main.type} onChange={(e) => setMain((m) => ({ ...m, type: e.target.value, code: '' }))}>
              <option value="CC">(CC) Cost Center</option>
              <option value="WBS">(WBS) Work Breakdown</option>
            </select>
          </div>
          <div>
            <label className="label">CC/WBS Charging Account</label>
            <AccountSelect value={main.code} opts={accForMain} onChange={(v) => setMain((m) => ({ ...m, code: v }))} />
          </div>
        </div>

        {/* Cost allocation */}
        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2">
          <label className="flex items-center gap-2 text-sm font-semibold text-[var(--ecs-navy)]">
            <input type="checkbox" className="w-4 h-4" disabled={!canEdit} checked={allocReq}
              onChange={(e) => setMode(e.target.checked ? 'CLAIM' : 'MAIN')} />
            Cost allocation required?
          </label>
          {allocReq && (
            <fieldset className="flex items-center gap-5 text-sm" disabled={!canEdit}>
              <label className="flex items-center gap-1.5"><input type="radio" checked={mode === 'CLAIM'} onChange={() => setMode('CLAIM')} /> Allocation at Claim/Item Level</label>
              <label className="flex items-center gap-1.5"><input type="radio" checked={mode === 'ITEM'} onChange={() => setMode('ITEM')} /> Allocation per Expense Item</label>
            </fieldset>
          )}
        </div>

        {mode === 'CLAIM' && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>
                <th className="th">Business Area</th><th className="th">CC/WBS Charging Account</th><th className="th">Internal Order</th>
                <th className="th text-right">Amount (SGD)</th><th className="th text-right">Percentage (%)</th><th className="th"></th>
              </tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="hover:bg-[var(--ecs-panel-2)]">
                    <td className="td">
                      <select className="field" disabled={!canEdit} value={r.ba} onChange={(e) => setRow(i, { ba: e.target.value, code: '' })}>
                        <option value="">Select…</option>
                        {baOptions.map((b) => <option key={b.code} value={b.code}>({b.code}) {b.name}</option>)}
                      </select>
                    </td>
                    <td className="td"><AccountSelect value={r.code} opts={accForBA(r.ba)} onChange={(v) => setRow(i, { code: v })} /></td>
                    <td className="td"><input className="field" disabled={!canEdit} value={r.io} placeholder="(optional)" onChange={(e) => setRow(i, { io: e.target.value })} /></td>
                    <td className="td text-right whitespace-nowrap">{fmt(Math.round(((Number(r.pct) || 0) / 100) * total))}</td>
                    <td className="td text-right"><input className="field text-right w-24 ml-auto" disabled={!canEdit} type="number" step="any" value={r.pct} onChange={(e) => setRow(i, { pct: e.target.value })} /></td>
                    <td className="td text-right">{canEdit && rows.length > 1 && <button type="button" className="btn-ghost text-xs" onClick={() => delRow(i)}>✕</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {canEdit && <button type="button" className="btn-secondary mt-2" onClick={addRow}>＋ Add allocation line</button>}
          </div>
        )}

        {mode === 'ITEM' && (
          <div className="mt-3">
            {anyDeptPreset && canEdit && (
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-xs text-[var(--ecs-muted)]">Each cost line can be split across one or more charging accounts. Apportioned lines can be charged to each traveller&apos;s home department (Workday).</p>
                <button type="button" className="btn-secondary text-xs whitespace-nowrap" onClick={autoDeptAll}>Auto-allocate all by traveller&apos;s dept</button>
              </div>
            )}
            {lines.length === 0 ? <p className="td italic text-[var(--ecs-muted)]">No cost lines yet.</p> : groupByCategory(lines).map((grp) => (
              <div key={grp.category} className="mb-4 rounded border border-[var(--ecs-border)] overflow-hidden">
                <div className="flex items-center justify-between bg-[var(--ecs-panel)] px-3 py-1.5 text-sm font-semibold text-[var(--ecs-navy)]">
                  <span>{grp.typeName}</span><span>{fmt(grp.net)}</span>
                </div>
                <div className="divide-y divide-[var(--ecs-border)]">
                  {grp.lines.map((l) => (
                    <div key={l.id} className="px-3 py-2">
                      <div className="flex items-center justify-between gap-3 text-sm mb-1">
                        <span className="font-medium">{l.travellerName ?? (l.isShared ? 'Shared — apportioned' : 'Requestor')}{l.isShared && <span className="pill-info ml-1">Shared</span>}</span>
                        <span className="text-[var(--ecs-muted)] whitespace-nowrap">{fmt(l.net)}</span>
                      </div>
                      <table className="w-full text-sm">
                        <tbody>
                          {(lineAllocs[l.id] ?? []).map((r, i) => (
                            <tr key={i}>
                              <td className="td py-1"><AccountSelect value={r.code} opts={accounts} onChange={(v) => setLineRow(l.id, i, { code: v })} /></td>
                              <td className="td py-1 w-24"><input className="field text-right" disabled={!canEdit} type="number" step="any" value={r.pct} placeholder="%" onChange={(e) => setLineRow(l.id, i, { pct: e.target.value })} /></td>
                              <td className="td py-1 w-28"><input className="field" disabled={!canEdit} value={r.io} placeholder="Int. order" onChange={(e) => setLineRow(l.id, i, { io: e.target.value })} /></td>
                              <td className="td py-1 text-right whitespace-nowrap w-28">{fmt(l.net * ((Number(r.pct) || 0) / 100))}</td>
                              <td className="td py-1 text-right w-8">{canEdit && (lineAllocs[l.id]?.length ?? 0) > 1 && <button type="button" className="btn-ghost text-xs" onClick={() => delLineRow(l.id, i)}>✕</button>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {canEdit && (
                        <div className="flex items-center gap-3 mt-1">
                          <button type="button" className="btn-ghost text-xs" onClick={() => addLineRow(l.id)}>＋ split</button>
                          {l.deptAllocs.length > 0 && <button type="button" className="btn-ghost text-xs" onClick={() => autoDept(l)}>Auto by dept</button>}
                          {!lineBalanced(l.id) && <span className="text-xs text-amber-700">line must total 100%</span>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <p className="text-xs text-[var(--ecs-muted)]">Each line&apos;s split must total 100%. The Allocation Outcome below rolls every line&apos;s split up to the request-level charging accounts.</p>
          </div>
        )}

        {/* Accounting Entries */}
        <div className="mt-5 border-t border-[var(--ecs-border)] pt-4">
          <h4 className="text-sm font-semibold text-[var(--ecs-navy)] mb-2">{entriesTitle}</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead><tr>
                <th className="th">Company</th><th className="th">Business area</th><th className="th">CC/WBS charging account</th>
                <th className="th">Internal Order</th><th className="th">GL account</th><th className="th">Expense type</th>
                <th className="th text-right">Amount</th><th className="th text-right">% of allocation</th><th className="th">Main acct</th><th className="th">GST</th>
              </tr></thead>
              <tbody>
                {entries.length === 0 ? <tr><td className="td italic text-[var(--ecs-muted)]" colSpan={10}>Nothing allocated yet.</td></tr> : entries.map((e, i) => {
                  const a = acc(e.code); const t = et(e.typeId);
                  return (
                    <tr key={i} className="hover:bg-[var(--ecs-panel-2)]">
                      <td className="td">{a?.companyCode ?? '—'}</td>
                      <td className="td">{a?.businessArea ?? '—'}</td>
                      <td className="td font-medium whitespace-nowrap">{e.code}{a?.research && <span className="pill-warn ml-1">Research</span>}{a?.crossCharge && <span className="pill-info ml-1">X-charge</span>}</td>
                      <td className="td">{e.io || '—'}</td>
                      <td className="td">{t?.gl ?? '—'}</td>
                      <td className="td">{t?.name ?? e.typeId}</td>
                      <td className="td text-right whitespace-nowrap font-medium">{fmt(e.amount)}</td>
                      <td className="td text-right">{e.percent}%</td>
                      <td className="td">{e.isMain ? 'Yes' : 'No'}</td>
                      <td className="td">{t?.gst ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-semibold text-[var(--ecs-navy)]">
                  <td className="td" colSpan={6}>Total {allocReq ? '' : '(main account)'}</td>
                  <td className="td text-right whitespace-nowrap">{fmt(entriesTotal)}</td>
                  <td className={`td text-right ${balanced ? 'text-emerald-700' : 'text-amber-700'}`}>{Math.round(totalPct * 10) / 10}%</td>
                  <td className="td" colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
          {allocReq && !balanced && <p className="text-xs text-amber-700 mt-2">Allocation must total 100% before the request can be submitted (AC06).</p>}
        </div>
      </div>

      {canEdit && <div className="flex justify-end"><button type="submit" className="btn-primary">{submitLabel}</button></div>}
    </form>
  );
}

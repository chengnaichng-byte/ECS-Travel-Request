'use client';
// #14 Excel full-replace for the M6 (upgrade-differential) account master. Parses the uploaded sheet
// client-side (SheetJS), previews the rows, and on apply calls the server action that atomically
// replaces the whole master. A template / current-export download gives the expected column format.
import { useState, useTransition } from 'react';
import * as XLSX from 'xlsx';

export interface M6Row { code: string; name: string; businessArea: string; companyCode: string; active: boolean; isDefault: boolean }

const HEADER = ['businessArea', 'code', 'name', 'companyCode', 'active', 'isDefault'];

function pick(r: Record<string, unknown>, aliases: string[]): string {
  const lower: Record<string, unknown> = {};
  for (const k of Object.keys(r)) lower[k.toLowerCase().replace(/\s+/g, '')] = r[k];
  for (const a of aliases) { const v = lower[a.replace(/\s+/g, '')]; if (v !== undefined && v !== '') return String(v).trim(); }
  return '';
}
function truthy(s: string, words: string[]): boolean { return words.some((w) => new RegExp(`^${w}$`, 'i').test(s.trim())); }

function normalizeRow(r: Record<string, unknown>): M6Row {
  const activeRaw = pick(r, ['active', 'status']);
  const defRaw = pick(r, ['isdefault', 'default']);
  return {
    businessArea: pick(r, ['businessarea', 'ba']),
    code: pick(r, ['code', 'accountcode', 'account']),
    name: pick(r, ['name', 'accountname']),
    companyCode: pick(r, ['companycode', 'company']) || '1000',
    active: activeRaw === '' ? true : !truthy(activeRaw, ['false', 'no', 'inactive', '0', 'n']),
    isDefault: truthy(defRaw, ['true', 'yes', 'default', 'y', '1']),
  };
}

export function M6AccountsUpload({ current, action }: {
  current: M6Row[];
  action: (rowsJson: string) => Promise<{ count: number; skipped: number } | null>;
}) {
  const [parsed, setParsed] = useState<M6Row[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const downloadTemplate = () => {
    const seed: M6Row[] = current.length ? current : [{ businessArea: 'BA-CS', code: 'M6-CS', name: 'SCSE — NTU-Funded Upgrade Differential', companyCode: '1000', active: true, isDefault: true }];
    const ws = XLSX.utils.json_to_sheet(seed.map((r) => ({ businessArea: r.businessArea, code: r.code, name: r.name, companyCode: r.companyCode, active: r.active, isDefault: r.isDefault })), { header: HEADER });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'M6 accounts');
    XLSX.writeFile(wb, 'm6-accounts.xlsx');
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setResult(null); setFileName(f.name);
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
      setParsed(raw.map(normalizeRow));
    } catch { setResult('Could not read that file — is it a valid .xlsx?'); setParsed(null); }
    e.target.value = '';
  };

  const apply = () => { if (!parsed) return; start(async () => { const res = await action(JSON.stringify(parsed)); setResult(res ? `Replaced the master with ${res.count} account(s)${res.skipped ? `, skipped ${res.skipped} invalid row(s)` : ''}.` : 'Not permitted — admin role required.'); setParsed(null); setFileName(''); }); };

  const valid = parsed?.filter((r) => r.code && r.name && r.businessArea) ?? [];

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--ecs-muted)]">Upload an Excel sheet to <strong>fully replace</strong> the M6 account master. Columns: <code>businessArea, code, name, companyCode, active, isDefault</code> (header row required; <code>active</code>/<code>isDefault</code> accept true/false or yes/no). At most one default per business area.</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-secondary text-xs" onClick={downloadTemplate}>⬇ Download template / current</button>
        <label className="btn-secondary text-xs cursor-pointer">⬆ Choose Excel file…<input type="file" accept=".xlsx,.xls" className="hidden" onChange={onFile} /></label>
        {fileName && <span className="text-xs text-[var(--ecs-muted)]">{fileName}</span>}
      </div>

      {parsed && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 space-y-2">
          <p className="text-sm text-amber-900"><strong>Preview — full replace.</strong> {valid.length} valid account(s){parsed.length - valid.length > 0 ? `, ${parsed.length - valid.length} invalid row(s) will be skipped` : ''}. Applying will <strong>delete all current M6 accounts</strong> and insert these.</p>
          <div className="overflow-x-auto max-h-56">
            <table className="w-full text-xs">
              <thead><tr><th className="th">BA</th><th className="th">Code</th><th className="th">Name</th><th className="th">Company</th><th className="th">Default</th><th className="th">Active</th></tr></thead>
              <tbody>
                {parsed.map((r, i) => (
                  <tr key={i} className={!r.code || !r.name || !r.businessArea ? 'text-red-600' : ''}>
                    <td className="td">{r.businessArea || '—'}</td><td className="td">{r.code || '—'}</td><td className="td">{r.name || '—'}</td><td className="td">{r.companyCode}</td><td className="td">{r.isDefault ? 'Yes' : '—'}</td><td className="td">{r.active ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" className="btn-primary text-xs" disabled={pending || valid.length === 0} onClick={apply}>{pending ? 'Replacing…' : `Replace all with ${valid.length} account(s)`}</button>
            <button type="button" className="btn-ghost text-xs" onClick={() => { setParsed(null); setFileName(''); }}>Cancel</button>
          </div>
        </div>
      )}

      {result && <p className="text-sm pill-pass inline-block">{result}</p>}
    </div>
  );
}

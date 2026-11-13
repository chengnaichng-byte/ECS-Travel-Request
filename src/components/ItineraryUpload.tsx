'use client';
// §13.20/§4.5 Bulk Excel upload of per-traveller itineraries AND personal days for a group request.
// Mirrors the M6 accounts upload: download a template (SheetJS), parse the file client-side, PREVIEW with
// row-level validation, then on apply call the server action (full-replace per traveller). The template
// carries an Airports reference sheet so people use valid codes; unknown codes/travellers are flagged in
// the preview and the server re-validates.
import { useState, useTransition } from 'react';
import * as XLSX from 'xlsx';

type Airport = { code: string; name: string; city: string };
type Traveller = { label: string; line: string };
type ItinRow = { traveller: string; seq: number; origin: string; dest: string; depart: string; arrive: string; class: string };
type PersRow = { traveller: string; from: string; to: string; note: string };
type Result = { travellers: number; legs: number; periods: number; errors: string[] };

const toISO = (v: unknown): string => {
  if (v == null || v === '') return '';
  if (v instanceof Date) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())).toISOString().slice(0, 10);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(s); return isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
};
const pick = (r: Record<string, unknown>, aliases: string[]): unknown => {
  const lower: Record<string, unknown> = {};
  for (const k of Object.keys(r)) lower[k.toLowerCase().replace(/\s+/g, '')] = r[k];
  for (const a of aliases) { const v = lower[a.replace(/\s+/g, '')]; if (v !== undefined && v !== '') return v; }
  return '';
};

export function ItineraryUpload({ action, travellers, airports, templateHref }: {
  action: (payloadJson: string) => Promise<Result | null>;
  travellers: Traveller[];
  airports: Airport[];
  templateHref: string;
}) {
  const [itin, setItin] = useState<ItinRow[] | null>(null);
  const [pers, setPers] = useState<PersRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const codes = new Set(airports.map((a) => a.code));
  const travLabels = new Set(travellers.flatMap((t) => [t.label.toLowerCase(), t.line, t.line.padStart(2, '0')]));
  const travOk = (t: string) => travLabels.has((t ?? '').trim().toLowerCase()) || travLabels.has((t ?? '').trim());

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setResult(null); setMsg(null); setFileName(f.name);
    try {
      const wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: 'array', cellDates: true });
      const sheet = (names: string[]) => { const n = wb.SheetNames.find((s) => names.some((x) => s.toLowerCase().includes(x))); return n ? wb.Sheets[n] : null; };
      const wsI = sheet(['itiner']) ?? wb.Sheets[wb.SheetNames[0]];
      const wsP = sheet(['personal']);
      const rawI = wsI ? XLSX.utils.sheet_to_json<Record<string, unknown>>(wsI, { defval: '' }) : [];
      const rawP = wsP ? XLSX.utils.sheet_to_json<Record<string, unknown>>(wsP, { defval: '' }) : [];
      setItin(rawI.map((r, i) => ({
        traveller: String(pick(r, ['traveller', 'name', 'lineno', 'line'])).trim(),
        seq: Number(pick(r, ['seq', 'sequence', 'order'])) || i + 1,
        origin: String(pick(r, ['origin', 'from', 'originairport'])).trim().toUpperCase(),
        dest: String(pick(r, ['dest', 'destination', 'to', 'destairport'])).trim().toUpperCase(),
        depart: toISO(pick(r, ['depart', 'departure', 'departdate'])),
        arrive: toISO(pick(r, ['arrive', 'arrival', 'arrivedate'])),
        class: String(pick(r, ['class', 'travelclass', 'cabin'])).trim(),
      })).filter((r) => r.origin || r.dest));
      setPers(rawP.map((r) => ({
        traveller: String(pick(r, ['traveller', 'name', 'lineno', 'line'])).trim(),
        from: toISO(pick(r, ['from', 'start', 'personalfrom'])),
        to: toISO(pick(r, ['to', 'end', 'personalto'])),
        note: String(pick(r, ['note', 'reason', 'remark'])).trim(),
      })).filter((r) => r.from || r.to));
    } catch { setMsg('Could not read that file — is it a valid .xlsx with Itineraries / Personal days sheets?'); setItin(null); setPers(null); }
    e.target.value = '';
  };

  const itinErr = (r: ItinRow) => !travOk(r.traveller) ? 'traveller' : !codes.has(r.origin) ? 'origin' : !codes.has(r.dest) ? 'dest' : '';
  const persErr = (r: PersRow) => !travOk(r.traveller) ? 'traveller' : (!r.from || !r.to) ? 'dates' : '';
  const blocking = (itin ?? []).some((r) => itinErr(r)) || (pers ?? []).some((r) => persErr(r));
  const hasData = (itin?.length ?? 0) > 0 || (pers?.length ?? 0) > 0;

  const apply = () => start(async () => {
    const res = await action(JSON.stringify({ itineraries: itin ?? [], personalDays: pers ?? [] }));
    if (!res) { setMsg('Not applied — the request is not an editable group, or you lack permission.'); return; }
    setResult(res); setItin(null); setPers(null); setFileName('');
  });

  const cell = (bad: boolean, v: string) => <td className={`td ${bad ? 'text-red-600 font-medium' : ''}`}>{v || '—'}</td>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--ecs-muted)]">Upload an Excel workbook to set <strong>per-traveller itineraries and personal days</strong> in bulk. Two sheets — <code>Itineraries</code> (Traveller, Seq, Origin, Dest, Depart, Arrive, Class) and <code>Personal days</code> (Traveller, From, To, Note). The Traveller, Origin, Dest and Class cells are <strong>dropdowns</strong> (pick a value); the <code>Airports</code> sheet lists the codes. Each named traveller&apos;s itinerary &amp; personal days are <strong>fully replaced</strong>; travellers not in the sheet are left unchanged.</p>
      <div className="flex flex-wrap items-center gap-3">
        <a href={templateHref} className="btn-secondary text-xs">⬇ Download Excel template</a>
        <label className="btn-secondary text-xs cursor-pointer">⬆ Choose Excel file…<input type="file" accept=".xlsx,.xls" className="hidden" onChange={onFile} /></label>
        {fileName && <span className="text-xs text-[var(--ecs-muted)]">{fileName}</span>}
      </div>

      {hasData && (
        <div className={`rounded border p-3 space-y-3 ${blocking ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'}`}>
          <p className="text-sm text-amber-900"><strong>Preview.</strong> {itin?.length ?? 0} itinerary leg(s), {pers?.length ?? 0} personal period(s).{blocking ? ' Fix the rows in red (unknown traveller, airport, or missing dates) before applying.' : ' Applying replaces each named traveller’s itinerary & personal days and re-derives the estimates.'}</p>
          {(itin?.length ?? 0) > 0 && (
            <div className="overflow-x-auto max-h-52">
              <table className="w-full text-xs"><thead><tr><th className="th">Traveller</th><th className="th">Seq</th><th className="th">Origin</th><th className="th">Dest</th><th className="th">Depart</th><th className="th">Arrive</th><th className="th">Class</th></tr></thead>
                <tbody>{itin!.map((r, i) => { const e = itinErr(r); return (<tr key={i}>{cell(e === 'traveller', r.traveller)}<td className="td">{r.seq}</td>{cell(e === 'origin', r.origin)}{cell(e === 'dest', r.dest)}<td className="td">{r.depart || '—'}</td><td className="td">{r.arrive || '—'}</td><td className="td">{r.class || '—'}</td></tr>); })}</tbody>
              </table>
            </div>
          )}
          {(pers?.length ?? 0) > 0 && (
            <div className="overflow-x-auto max-h-40">
              <table className="w-full text-xs"><thead><tr><th className="th">Traveller</th><th className="th">From</th><th className="th">To</th><th className="th">Note</th></tr></thead>
                <tbody>{pers!.map((r, i) => { const e = persErr(r); return (<tr key={i}>{cell(e === 'traveller', r.traveller)}{cell(e === 'dates', r.from)}{cell(e === 'dates', r.to)}<td className="td">{r.note || '—'}</td></tr>); })}</tbody>
              </table>
            </div>
          )}
          <div className="flex items-center gap-3">
            <button type="button" className="btn-primary text-xs" disabled={pending || blocking} onClick={apply}>{pending ? 'Applying…' : 'Apply upload'}</button>
            <button type="button" className="btn-ghost text-xs" onClick={() => { setItin(null); setPers(null); setFileName(''); }}>Cancel</button>
          </div>
        </div>
      )}

      {msg && <p className="text-sm pill-exc inline-block">{msg}</p>}
      {result && (
        <div className="text-sm">
          <p className="pill-pass inline-block">Applied — {result.travellers} traveller(s): {result.legs} leg(s), {result.periods} personal period(s).</p>
          {result.errors.length > 0 && <ul className="mt-2 text-xs text-amber-800 list-disc ml-5">{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}

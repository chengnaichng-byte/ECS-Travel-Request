'use client';
// TR-01 dashboard request list with live filters (search · type · status). Type is shown as a
// one-letter code — S (Standard) / E (Emergency: book first, raise later). Rows are passed in
// already scoped to the viewer (their own requests, or all for an administrator).
import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { StatusPill } from '@/components/StatusPill';

export interface DashRow {
  id: string; requestNumber: string; type: 'S' | 'E';
  traveller: string; purpose: string; dest: string; dates: string; ntu: string;
  isGroup: boolean; isGuest: boolean; exceptions: number; status: string; bookingStatus: string;
}

export function DashboardRequests({ rows }: { rows: DashRow[] }) {
  const [q, setQ] = useState('');
  const [type, setType] = useState<'ALL' | 'S' | 'E'>('ALL');
  const [status, setStatus] = useState('ALL');
  // The filters only work once this client component has hydrated. Until then, disable them so a
  // user can't change an inert control and think it is broken (noticeable only on a slow first load).
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const statuses = useMemo(() => [...new Set(rows.map((r) => r.status))].sort(), [rows]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (type !== 'ALL' && r.type !== type) return false;
      if (status !== 'ALL' && r.status !== status) return false;
      if (needle && !`${r.requestNumber} ${r.traveller} ${r.dest} ${r.purpose}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, q, type, status]);

  const TypePill = ({ t }: { t: 'S' | 'E' }) => t === 'E'
    ? <span className="pill-exc" title="Emergency — book first, raise/approve later (DD-23)">E</span>
    : <span className="pill-info" title="Standard">S</span>;

  return (
    <div>
      {/* Filters — disabled until the component is interactive (hydrated). */}
      <div className={`flex flex-wrap items-end gap-3 mb-3 ${ready ? '' : 'opacity-60'}`}>
        <div className="flex-1 min-w-[12rem]">
          <label className="label">Search</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} disabled={!ready} placeholder={ready ? 'Request no., traveller, destination, purpose…' : 'Loading filters…'} className="field disabled:cursor-not-allowed" />
        </div>
        <div>
          <label className="label">Type</label>
          <select value={type} onChange={(e) => setType(e.target.value as 'ALL' | 'S' | 'E')} disabled={!ready} className="field w-40 disabled:cursor-not-allowed">
            <option value="ALL">All types</option>
            <option value="S">S · Standard</option>
            <option value="E">E · Emergency</option>
          </select>
        </div>
        <div>
          <label className="label">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} disabled={!ready} className="field w-56 disabled:cursor-not-allowed">
            <option value="ALL">All statuses</option>
            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {ready && (q || type !== 'ALL' || status !== 'ALL') && (
          <button type="button" onClick={() => { setQ(''); setType('ALL'); setStatus('ALL'); }} className="btn-ghost text-xs">Clear</button>
        )}
      </div>

      <div className="text-xs text-[var(--ecs-muted)] mb-2">Showing {filtered.length} of {rows.length}. <span className="ml-2">Type: <span className="pill-info">S</span> Standard · <span className="pill-exc">E</span> Emergency (book first, raise later).</span></div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th className="th">Request</th><th className="th">Type</th><th className="th">Traveller</th><th className="th">Purpose</th>
              <th className="th">Destination</th><th className="th">Travel dates</th>
              <th className="th text-right">Est. NTU cost</th><th className="th">Exc.</th>
              <th className="th">Status</th><th className="th">Booking</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className={r.exceptions > 0 ? 'bg-[#fff8ec] hover:bg-[#ffeedd]' : 'hover:bg-[var(--ecs-panel-2)]'}>
                <td className="td font-medium">
                  {/* A draft / sent-back request opens straight into the editing wizard so the
                      traveller can continue editing; everything else opens the read view. */}
                  <Link href={r.status === 'Draft' || r.status === 'Sent Back' ? `/requests/${r.id}/trip` : `/requests/${r.id}/details`} className="text-[var(--ecs-navy-2)] hover:underline">{r.requestNumber}</Link>
                  {(r.status === 'Draft' || r.status === 'Sent Back') && <span className="pill-warn ml-1">Edit</span>}
                  {r.isGroup && <span className="pill-navy ml-1">Group</span>}
                </td>
                <td className="td"><TypePill t={r.type} /></td>
                <td className="td">{r.traveller}{r.isGuest && <span className="pill-info ml-1">Guest</span>}</td>
                <td className="td">{r.purpose}</td>
                <td className="td">{r.dest}</td>
                <td className="td whitespace-nowrap">{r.dates}</td>
                <td className="td text-right whitespace-nowrap">{r.ntu}</td>
                <td className="td text-center">{r.exceptions > 0 ? <span className="pill-exc">⚠ {r.exceptions}</span> : '—'}</td>
                <td className="td"><StatusPill status={r.status} /></td>
                <td className="td text-xs text-[var(--ecs-muted)]">{r.bookingStatus}</td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td className="td text-[var(--ecs-muted)]" colSpan={10}>No requests match the filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

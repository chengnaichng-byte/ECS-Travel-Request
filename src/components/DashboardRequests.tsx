'use client';
// TR-01 dashboard request list with live filters (search · type · status). Type is shown as a
// one-letter code — S (Standard) / E (Emergency: book first, raise later). Rows are passed in
// already scoped to the viewer (their own requests, or all for an administrator).
import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { StatusPill } from '@/components/StatusPill';
import { useTableSort, SortableTh } from '@/components/tableSort';

export interface DashRow {
  id: string; requestNumber: string; type: 'S' | 'E'; kind: 'IND' | 'GRP' | 'GST'; groupType?: 'STAFF' | 'STUDENT' | 'MIXED' | null;
  ba: string; traveller: string; requestor: string; purpose: string; dest: string; dates: string; ntu: string;
  exceptions: number; status: string; bookingStatus: string;
  startSort: string | null; ntuSort: number;   // raw values for date / cost sorting (not the formatted strings)
  ta?: string | null; pnrs?: string;   // booking provenance — TA number + PNR(s), for search + inline display
  teClaim?: { number: string; status: string } | null;   // §13.8 the linked TE expense claim once the trip is claimed
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
      if (needle && !`${r.requestNumber} ${r.ta ?? ''} ${r.pnrs ?? ''} ${r.traveller} ${r.dest} ${r.purpose}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, q, type, status]);

  // Column sorting (two-state asc/desc) — applied AFTER the filters so both compose. Sort keys use
  // raw values (startSort / ntuSort / exception count) so dates and money order numerically.
  const accessors = useMemo(() => ({
    requestNumber: (r: DashRow) => r.requestNumber,
    ba: (r: DashRow) => r.ba,
    traveller: (r: DashRow) => r.traveller,
    requestor: (r: DashRow) => r.requestor,
    purpose: (r: DashRow) => r.purpose,
    dest: (r: DashRow) => r.dest,
    dates: (r: DashRow) => r.startSort,
    ntu: (r: DashRow) => r.ntuSort,
    exceptions: (r: DashRow) => r.exceptions,
    status: (r: DashRow) => r.status,
    bookingStatus: (r: DashRow) => r.bookingStatus,
  }), []);
  const { sorted, sort, toggle } = useTableSort(filtered, accessors, { key: 'requestNumber', dir: 'desc' });

  const TypePill = ({ t }: { t: 'S' | 'E' }) => t === 'E'
    ? <span className="pill-exc" title="Emergency — book first, raise/approve later (DD-23)">E</span>
    : <span className="pill-info" title="Standard">S</span>;
  const KindPill = ({ k, gt }: { k: 'IND' | 'GRP' | 'GST'; gt?: 'STAFF' | 'STUDENT' | 'MIXED' | null }) => {
    const sub = k === 'GRP' && gt === 'STUDENT' ? 'Student' : k === 'GRP' && gt === 'MIXED' ? 'Mixed' : k === 'GRP' && gt === 'STAFF' ? 'Staff' : '';
    const label = k === 'GRP' ? `${sub ? sub + ' ' : ''}group booking` : k === 'GST' ? 'Guest booking' : 'Individual booking';
    return <span className="pill-navy" title={label}>{k}{sub ? `·${sub === 'Student' ? 'Stu' : sub === 'Mixed' ? 'Mix' : 'Staff'}` : ''}</span>;
  };

  return (
    <div>
      {/* Filters — disabled until the component is interactive (hydrated). */}
      <div className={`flex flex-wrap items-end gap-3 mb-3 ${ready ? '' : 'opacity-60'}`}>
        <div className="flex-1 min-w-[12rem]">
          <label className="label">Search</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} disabled={!ready} placeholder={ready ? 'Request no., TA / PNR, traveller, destination, purpose…' : 'Loading filters…'} className="field disabled:cursor-not-allowed" />
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

      <div className="text-xs text-[var(--ecs-muted)] mb-2">Showing {filtered.length} of {rows.length}. <span className="ml-2">Type: <span className="pill-info">S</span> Standard · <span className="pill-exc">E</span> Emergency · Booking: <span className="pill-navy">IND</span> Individual · <span className="pill-navy">GRP</span> Group · <span className="pill-navy">GST</span> Guest.</span></div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <SortableTh sortKey="requestNumber" sort={sort} onSort={toggle} disabled={!ready}>Request</SortableTh>
              <SortableTh sortKey="ba" sort={sort} onSort={toggle} disabled={!ready}>Business area</SortableTh>
              <SortableTh sortKey="traveller" sort={sort} onSort={toggle} disabled={!ready}>Traveller</SortableTh>
              <SortableTh sortKey="requestor" sort={sort} onSort={toggle} disabled={!ready}>Requestor</SortableTh>
              <SortableTh sortKey="purpose" sort={sort} onSort={toggle} disabled={!ready}>Purpose</SortableTh>
              <SortableTh sortKey="dest" sort={sort} onSort={toggle} disabled={!ready}>Destination</SortableTh>
              <SortableTh sortKey="dates" sort={sort} onSort={toggle} disabled={!ready}>Travel dates</SortableTh>
              <SortableTh sortKey="ntu" sort={sort} onSort={toggle} disabled={!ready} align="right">Est. NTU cost</SortableTh>
              <SortableTh sortKey="exceptions" sort={sort} onSort={toggle} disabled={!ready} align="center">Exc.</SortableTh>
              <SortableTh sortKey="status" sort={sort} onSort={toggle} disabled={!ready}>Status</SortableTh>
              <SortableTh sortKey="bookingStatus" sort={sort} onSort={toggle} disabled={!ready}>Booking</SortableTh>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id} className={r.exceptions > 0 ? 'bg-[#fff8ec] hover:bg-[#ffeedd]' : 'hover:bg-[var(--ecs-panel-2)]'}>
                <td className="td font-medium">
                  {/* A draft / sent-back request opens straight into the editing wizard so the
                      traveller can continue editing; everything else opens the read view. */}
                  <div className="flex items-center gap-1 flex-wrap">
                    <Link href={r.status === 'Draft' || r.status === 'Sent Back' ? `/requests/${r.id}/trip` : `/requests/${r.id}/details`} className="text-[var(--ecs-navy-2)] hover:underline">{r.requestNumber}</Link>
                    <TypePill t={r.type} /><KindPill k={r.kind} gt={r.groupType} />
                    {(r.status === 'Draft' || r.status === 'Sent Back') && <span className="pill-warn">Edit</span>}
                  </div>
                  {r.ta && <div className="text-[11px] text-[var(--ecs-muted)] font-mono mt-0.5">{r.ta}{r.pnrs ? ` · ${r.pnrs.trim().split(/\s+/).length > 1 ? `${r.pnrs.trim().split(/\s+/).length} PNRs` : r.pnrs.trim()}` : ''}</div>}
                  {r.teClaim && <div className="text-[11px] mt-0.5"><span className="pill-info">TE · {r.teClaim.status}</span> <span className="font-mono text-[var(--ecs-muted)]">{r.teClaim.number}</span></div>}
                </td>
                <td className="td">{r.ba}</td>
                <td className="td">{r.traveller}</td>
                <td className="td">{r.requestor}</td>
                <td className="td">{r.purpose}</td>
                <td className="td">{r.dest}</td>
                <td className="td whitespace-nowrap">{r.dates}</td>
                <td className="td text-right whitespace-nowrap">{r.ntu}</td>
                <td className="td text-center">{r.exceptions > 0 ? <span className="pill-exc">⚠ {r.exceptions}</span> : '—'}</td>
                <td className="td"><StatusPill status={r.status} /></td>
                <td className="td text-xs text-[var(--ecs-muted)]">{r.bookingStatus}</td>
              </tr>
            ))}
            {sorted.length === 0 && <tr><td className="td text-[var(--ecs-muted)]" colSpan={11}>No requests match the filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

'use client';
// DD-30 — client-side CSV export of the CTA charges listing, so finance can reconcile against the
// provider statement outside ECS. Type-only import (erased at build; the server module is not bundled).
import type { CtaChargeRow } from '@/modules/te/ctaCharges';

export function ExportCtaCsv({ rows }: { rows: CtaChargeRow[] }) {
  const download = () => {
    const head = ['Request', 'TA', 'Traveller', 'PNR', 'Ticket', 'Type', 'Detail', 'Settled', 'Charged date', 'Amount SGD', 'CTA account', 'CTA account label', 'Credit GL (clearing)', 'Provider'];
    const esc = (v: string | number | null) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [head.join(',')];
    for (const r of rows) {
      lines.push([r.requestNumber, r.authorisationNo, r.travellerName, r.pnr, r.ticketNo, r.type, r.detail, r.settled ? 'Settled' : 'Pending', r.chargeDate, r.amountSgd, r.ctaAccountId, r.ctaAccountLabel, r.clearingGlAccount, r.provider].map(esc).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `cta-charges-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };
  return <button type="button" onClick={download} className="btn-secondary" disabled={rows.length === 0}>Export CSV</button>;
}

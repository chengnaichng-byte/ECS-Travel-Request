// DD-30 CTA Charges — a read-only, ONE-SIDED listing of central-settled (CTA-paid) charges
// captured from the TMC feed, for finance to reconcile against the provider statement outside ECS.
// Settled charges are grouped by credit GL (CTA clearing) account — the credit side of the
// accounting entry, derived from the CTA master; the debit (expense cost object + GL) is set at the
// claim. Charges that are booked but not yet charged to the CTA are shown separately as pending.
import Link from 'next/link';
import { listCtaCharges, type CtaChargeRow } from '@/modules/te/ctaCharges';
import { fmtSgd } from '@/modules/pretrip/pricing';
import { PageTitle, Card, Empty } from '@/components/ui';
import { ExportCtaCsv } from '@/components/ExportCtaCsv';
import { SortableTable, type SortCol, type SortRow } from '@/components/SortableTable';

export const dynamic = 'force-dynamic';

const CTA_COLS: SortCol[] = [
  { key: 'request', label: 'Request' },
  { key: 'ta', label: 'TA' },
  { key: 'traveller', label: 'Traveller' },
  { key: 'pnrTicket', label: 'PNR / ticket', sortable: false },
  { key: 'type', label: 'Type' },
  { key: 'detail', label: 'Detail' },
  { key: 'charged', label: 'Charged' },
  { key: 'ctaAccount', label: 'CTA account' },
  { key: 'creditGl', label: 'Credit GL' },
  { key: 'posting', label: 'Posting (SAP)' },
  { key: 'amount', label: 'Amount (SGD)', align: 'right' },
];

// Reuse the row rendering for both the settled-group tables and the pending table; returns the
// SortableTable rows (raw sort values + the server-rendered cells).
function chargeSortRows(rows: CtaChargeRow[], pending?: boolean): SortRow[] {
  return rows.map((r, i) => ({
    key: String(i),
    className: 'hover:bg-[var(--ecs-panel-2)]',
    sort: {
      request: r.requestNumber, ta: r.authorisationNo ?? '', traveller: r.travellerName,
      type: r.type, detail: r.detail, charged: pending ? null : (r.chargeDate ?? null),
      ctaAccount: r.ctaAccountId ?? '', creditGl: r.clearingGlAccount,
      posting: pending ? '' : r.postingStatus, amount: r.amountSgd,
    },
    cells: (<>
      <td className="td"><Link href={`/requests/${r.requestId}`} className="font-mono text-[var(--ecs-navy)] hover:underline">{r.requestNumber}</Link></td>
      <td className="td font-mono text-xs">{r.authorisationNo ?? '—'}</td>
      <td className="td">{r.travellerName}</td>
      <td className="td font-mono text-xs">{r.pnr ?? '—'}{r.ticketNo ? ` · ${r.ticketNo}` : ''}</td>
      <td className="td">{r.type}</td>
      <td className="td">{r.detail}</td>
      <td className="td whitespace-nowrap">{pending ? <span className="pill-warn">pending</span> : (r.chargeDate ?? '—')}</td>
      <td className="td font-mono text-xs" title={r.ctaAccountLabel}>{r.ctaAccountId ?? '—'}</td>
      <td className="td font-mono text-xs" title="Credit side of the accounting entry (CTA clearing account, from the CTA master)">{r.clearingGlAccount}</td>
      <td className="td whitespace-nowrap">{pending ? <span className="text-[var(--ecs-muted)]">—</span> : (<>
        <span className={r.postingStatus === 'Posted' ? 'pill-pass' : r.postingStatus === 'Reversed' ? 'pill-warn' : 'pill-info'}>{r.postingStatus}</span>
        {r.sapDocNo && <span className="font-mono text-xs ml-1 text-[var(--ecs-muted)]">{r.sapDocNo}</span>}
      </>)}</td>
      <td className="td text-right">{fmtSgd(r.amountSgd)}</td>
    </>),
  }));
}

export default async function CtaChargesPage() {
  const { settledGroups, pending, totalSettled, settledCount, totalPending, pendingCount } = await listCtaCharges();
  const allRows = settledGroups.flatMap((g) => g.rows).concat(pending);

  return (
    <div className="w-full space-y-5">
      <PageTitle id="DD-30 · read-only" title="CTA Charges"
        subtitle="Central-settled (CTA-paid) airfare and hotel charges captured from the TMC feed, grouped by credit GL account. A charge appears under its credit GL once the feed reports it settled on the CTA, and posts to SAP on receipt (DD-31) — the Posting column shows the SAP document and status (auto-reversed on cancellation). A booked-but-not-yet-charged booking is shown under Pending settlement. The full journal is on the CTA Accounting Entries screen." />

      <div className="flex flex-wrap items-center gap-3">
        <div className="text-sm text-[var(--ecs-muted)]">
          {settledCount} settled charge(s) · total {fmtSgd(totalSettled)} across {settledGroups.length} credit GL account(s)
          {pendingCount > 0 && <span> · {pendingCount} pending settlement ({fmtSgd(totalPending)})</span>}
        </div>
        <div className="ml-auto"><ExportCtaCsv rows={allRows} /></div>
      </div>

      {settledGroups.length === 0 ? (
        <Card title="Settled CTA charges"><Empty>No settled CTA charges yet.</Empty></Card>
      ) : settledGroups.map((g) => (
        <Card key={g.clearingGlAccount} title={`Credit GL ${g.clearingGlAccount} · CTA clearing${g.ctaAccountIds.length ? `  ·  ${g.ctaAccountIds.join(', ')}` : ''}`}>
          <div className="overflow-x-auto">
            <SortableTable
              tableClassName="w-full text-sm"
              initialSort={{ key: 'request', dir: 'asc' }}
              columns={CTA_COLS}
              rows={chargeSortRows(g.rows)}
              foot={<tfoot><tr className="border-t border-[var(--ecs-border)] font-semibold text-[var(--ecs-navy)]">
                <td className="td" colSpan={10}>Subtotal → credit GL {g.clearingGlAccount}</td>
                <td className="td text-right">{fmtSgd(g.subtotalSgd)}</td>
              </tr></tfoot>}
            />
          </div>
        </Card>
      ))}

      {pendingCount > 0 && (
        <Card title={`Pending settlement — booked, not yet charged to the CTA (${pendingCount})`}>
          <div className="overflow-x-auto">
            <SortableTable
              tableClassName="w-full text-sm"
              initialSort={{ key: 'request', dir: 'asc' }}
              columns={CTA_COLS}
              rows={chargeSortRows(pending, true)}
              foot={<tfoot><tr className="border-t border-[var(--ecs-border)] font-semibold text-[var(--ecs-navy)]">
                <td className="td" colSpan={10}>Total pending settlement</td>
                <td className="td text-right">{fmtSgd(totalPending)}</td>
              </tr></tfoot>}
            />
          </div>
          <p className="text-xs text-[var(--ecs-muted)] mt-2">These bookings are confirmed but the airfare/hotel has not yet posted to the CTA, so they are not yet on the provider statement. They move into their credit GL group once the feed reports them charged. The <strong>Credit GL</strong> shown is the account they will post to.</p>
        </Card>
      )}

      <p className="text-xs text-[var(--ecs-muted)]">The CTA account is reported by the card / TMC feed on each charge; the CTA master (DD-30) maps it to its <strong>credit GL (clearing) account</strong> — the credit side of the accounting entry generated when the charge posts. The debit (the expense cost object and GL) is determined at the claim. This listing is ECS&apos;s side only — reconciliation against the provider statement is performed outside ECS.</p>
    </div>
  );
}

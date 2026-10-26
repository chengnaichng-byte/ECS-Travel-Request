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

export const dynamic = 'force-dynamic';

function ChargeRows({ rows, pending }: { rows: CtaChargeRow[]; pending?: boolean }) {
  return (
    <>
      {rows.map((r, i) => (
        <tr key={i} className="hover:bg-[var(--ecs-panel-2)]">
          <td className="td"><Link href={`/requests/${r.requestId}`} className="font-mono text-[var(--ecs-navy)] hover:underline">{r.requestNumber}</Link></td>
          <td className="td font-mono text-xs">{r.authorisationNo ?? '—'}</td>
          <td className="td">{r.travellerName}</td>
          <td className="td font-mono text-xs">{r.pnr ?? '—'}{r.ticketNo ? ` · ${r.ticketNo}` : ''}</td>
          <td className="td">{r.type}</td>
          <td className="td">{r.detail}</td>
          <td className="td whitespace-nowrap">{pending ? <span className="pill-warn">pending</span> : (r.chargeDate ?? '—')}</td>
          <td className="td font-mono text-xs" title={r.ctaAccountLabel}>{r.ctaAccountId ?? '—'}</td>
          <td className="td font-mono text-xs" title="Credit side of the accounting entry (CTA clearing account, from the CTA master)">{r.clearingGlAccount}</td>
          <td className="td text-right">{fmtSgd(r.amountSgd)}</td>
        </tr>
      ))}
    </>
  );
}

const HEAD = (
  <thead><tr>
    <th className="th">Request</th><th className="th">TA</th><th className="th">Traveller</th><th className="th">PNR / ticket</th>
    <th className="th">Type</th><th className="th">Detail</th><th className="th">Charged</th><th className="th">CTA account</th>
    <th className="th">Credit GL</th><th className="th text-right">Amount (SGD)</th>
  </tr></thead>
);

export default async function CtaChargesPage() {
  const { settledGroups, pending, totalSettled, settledCount, totalPending, pendingCount } = await listCtaCharges();
  const allRows = settledGroups.flatMap((g) => g.rows).concat(pending);

  return (
    <div className="w-full space-y-5">
      <PageTitle id="DD-30 · read-only" title="CTA Charges"
        subtitle="Central-settled (CTA-paid) airfare and hotel charges captured from the TMC feed, grouped by credit GL account. A charge appears under its credit GL only once the feed reports it settled on the CTA (ticketed/charged); a booked-but-not-yet-charged booking is shown under Pending settlement. The credit side of each accounting entry is the CTA clearing account, derived from the CTA master; the debit (expense cost object + GL) is set at the claim. One-sided — ECS does not match or post here; its posting programme handles the GL posting." />

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
            <table className="w-full text-sm">
              {HEAD}
              <tbody><ChargeRows rows={g.rows} /></tbody>
              <tfoot><tr className="border-t border-[var(--ecs-border)] font-semibold text-[var(--ecs-navy)]">
                <td className="td" colSpan={9}>Subtotal → credit GL {g.clearingGlAccount}</td>
                <td className="td text-right">{fmtSgd(g.subtotalSgd)}</td>
              </tr></tfoot>
            </table>
          </div>
        </Card>
      ))}

      {pendingCount > 0 && (
        <Card title={`Pending settlement — booked, not yet charged to the CTA (${pendingCount})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              {HEAD}
              <tbody><ChargeRows rows={pending} pending /></tbody>
              <tfoot><tr className="border-t border-[var(--ecs-border)] font-semibold text-[var(--ecs-navy)]">
                <td className="td" colSpan={9}>Total pending settlement</td>
                <td className="td text-right">{fmtSgd(totalPending)}</td>
              </tr></tfoot>
            </table>
          </div>
          <p className="text-xs text-[var(--ecs-muted)] mt-2">These bookings are confirmed but the airfare/hotel has not yet posted to the CTA, so they are not yet on the provider statement. They move into their credit GL group once the feed reports them charged. The <strong>Credit GL</strong> shown is the account they will post to.</p>
        </Card>
      )}

      <p className="text-xs text-[var(--ecs-muted)]">The CTA account is reported by the card / TMC feed on each charge; the CTA master (DD-30) maps it to its <strong>credit GL (clearing) account</strong> — the credit side of the accounting entry generated when the charge posts. The debit (the expense cost object and GL) is determined at the claim. This listing is ECS&apos;s side only — reconciliation against the provider statement is performed outside ECS.</p>
    </div>
  );
}

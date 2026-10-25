// DD-30 CTA Charges — a read-only, ONE-SIDED listing of central-settled (CTA-paid) charges
// captured from the TMC feed, grouped by clearing account, for finance to reconcile against the
// provider statement outside ECS. No matching, no status, no posting here (ECS's posting
// programme posts; this view only lists what ECS captured and the clearing account each maps to).
import Link from 'next/link';
import { listCtaCharges } from '@/modules/te/ctaCharges';
import { fmtSgd } from '@/modules/pretrip/pricing';
import { PageTitle, Card, Empty } from '@/components/ui';
import { ExportCtaCsv } from '@/components/ExportCtaCsv';

export const dynamic = 'force-dynamic';

export default async function CtaChargesPage() {
  const { groups, totalSgd, rowCount } = await listCtaCharges();
  const allRows = groups.flatMap((g) => g.rows);

  return (
    <div className="w-full space-y-5">
      <PageTitle id="DD-30 · read-only" title="CTA Charges"
        subtitle="Central-settled (CTA-paid) airfare and hotel charges captured from the TMC feed, grouped by clearing account. A one-sided listing for finance to reconcile against the provider statement — ECS does not match or post here; its posting programme handles the GL posting." />

      <div className="flex flex-wrap items-center gap-3">
        <div className="text-sm text-[var(--ecs-muted)]">{rowCount} charge(s) · total {fmtSgd(totalSgd)} across {groups.length} clearing account(s)</div>
        <div className="ml-auto"><ExportCtaCsv rows={allRows} /></div>
      </div>

      {groups.length === 0 ? (
        <Card title="CTA charges"><Empty>No CTA-settled charges captured yet. Book a trip whose airfare or hotel is paid on the CTA.</Empty></Card>
      ) : groups.map((g) => (
        <Card key={g.clearingGlAccount} title={`Clearing ${g.clearingGlAccount}${g.ctaAccountIds.length ? `  ·  ${g.ctaAccountIds.join(', ')}` : ''}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>
                <th className="th">Request</th><th className="th">TA</th><th className="th">Traveller</th><th className="th">PNR / ticket</th>
                <th className="th">Type</th><th className="th">Detail</th><th className="th">Booked</th><th className="th">CTA account</th>
                <th className="th text-right">Amount (SGD)</th><th className="th"></th>
              </tr></thead>
              <tbody>
                {g.rows.map((r, i) => (
                  <tr key={i} className="hover:bg-[var(--ecs-panel-2)]">
                    <td className="td"><Link href={`/requests/${r.requestId}`} className="font-mono text-[var(--ecs-navy)] hover:underline">{r.requestNumber}</Link></td>
                    <td className="td font-mono text-xs">{r.authorisationNo ?? '—'}</td>
                    <td className="td">{r.travellerName}</td>
                    <td className="td font-mono text-xs">{r.pnr ?? '—'}{r.ticketNo ? ` · ${r.ticketNo}` : ''}</td>
                    <td className="td">{r.type}</td>
                    <td className="td">{r.detail}</td>
                    <td className="td whitespace-nowrap">{r.bookedDate ?? '—'}</td>
                    <td className="td font-mono text-xs" title={r.ctaAccountLabel}>{r.ctaAccountId ?? '—'}</td>
                    <td className="td text-right">{fmtSgd(r.amountSgd)}</td>
                    <td className="td text-right">{r.claimId ? <Link href={`/claims/${r.claimId}`} className="btn-ghost text-xs">Claim →</Link> : null}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t border-[var(--ecs-border)] font-semibold text-[var(--ecs-navy)]">
                <td className="td" colSpan={8}>Subtotal → clearing {g.clearingGlAccount}</td>
                <td className="td text-right">{fmtSgd(g.subtotalSgd)}</td><td className="td"></td>
              </tr></tfoot>
            </table>
          </div>
        </Card>
      ))}

      <p className="text-xs text-[var(--ecs-muted)]">The CTA account is reported by the card / TMC feed on each charge; the CTA master (DD-30) maps it to its clearing account. This listing is ECS&apos;s side only — reconciliation against the provider statement is performed outside ECS.</p>
    </div>
  );
}

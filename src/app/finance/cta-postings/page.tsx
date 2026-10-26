// DD-31 (proposed) CTA Accounting Entries — a read-only PREVIEW of the SAP GL journal each settled
// CTA charge would post on receipt (not at claim). This is the validation report; the posting
// itself is not yet wired. Shows, per charge, the Dr/Cr lines, how the amount splits across the
// approved charging allocation, the credit GL from the CTA master, and the balance.
import Link from 'next/link';
import { computeCtaPostings } from '@/modules/pretrip/ctaPosting';
import { fmtSgd } from '@/modules/pretrip/pricing';
import { PageTitle, Card, Empty } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function CtaPostingsPage() {
  const { postings, totalDr, totalCr, count } = await computeCtaPostings();
  const balanced = Math.abs(totalDr - totalCr) < 0.005;

  return (
    <div className="w-full space-y-5">
      <PageTitle id="DD-31 · preview" title="CTA Accounting Entries"
        subtitle="The SAP GL journal each settled CTA charge would post on receipt from the TMC (not at claim). Preview only — the posting is not yet wired; this report is to validate the entries and how they are computed." />

      <Card title="How each entry is computed">
        <ul className="text-sm text-[var(--ecs-muted)] space-y-1.5 list-disc pl-5">
          <li><strong>Trigger.</strong> Only charges the feed reports <strong>settled</strong> on the CTA (ticketed/charged); a booked-but-pending charge does not post until settled.</li>
          <li><strong>Amount (gross).</strong> Airfare = fare + taxes + fees; accommodation = the booked hotel total — taken from the TMC feed.</li>
          <li><strong>Debit (expense).</strong> GL from the expense type (airfare <code>GL-6110</code>, accommodation <code>GL-6120</code>), split across the <strong>approved charging allocation</strong> (CC/WBS × %), last line absorbing rounding.</li>
          <li><strong>Input GST.</strong> From the expense type&apos;s GST code; CTA airfare &amp; accommodation are <strong>ZP (zero-rated)</strong>, so there is no tax line. A GST-rated charge would add a <code>Dr Input GST</code> line and post the expense net.</li>
          <li><strong>Credit (clearing).</strong> The <strong>credit GL</strong> of the charge&apos;s CTA account, from the CTA master — the full gross amount.</li>
          <li><strong>Reversal.</strong> A later cancellation / refund posts the <strong>same entry reversed</strong> (auto-reversal).</li>
        </ul>
      </Card>

      <div className="text-sm text-[var(--ecs-muted)]">
        {count} posting(s) · total Dr {fmtSgd(totalDr)} = total Cr {fmtSgd(totalCr)} {balanced ? <span className="pill-pass ml-1">balanced</span> : <span className="pill-stop ml-1">out of balance</span>}
      </div>

      {postings.length === 0 ? <Card title="CTA accounting entries"><Empty>No settled CTA charges to post yet.</Empty></Card> : postings.map((p, i) => (
        <Card key={i} title={`${p.chargeType} · ${p.requestNumber}`}>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--ecs-muted)] mb-3">
            <span>TA <span className="font-mono text-[var(--ecs-ink)]">{p.authorisationNo ?? '—'}</span></span>
            <span>Traveller <span className="text-[var(--ecs-ink)]">{p.travellerName}</span></span>
            <span>PNR <span className="font-mono text-[var(--ecs-ink)]">{p.pnr ?? '—'}</span></span>
            <span>Charged <span className="text-[var(--ecs-ink)]">{p.chargeDate ?? '—'}</span></span>
            <span>CTA <span className="font-mono text-[var(--ecs-ink)]">{p.ctaAccountId ?? '—'}</span> → credit GL <span className="font-mono text-[var(--ecs-ink)]">{p.clearingGlAccount}</span></span>
            <Link href={`/requests/${p.requestId}`} className="text-[var(--ecs-navy)] hover:underline ml-auto">View request →</Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>
                <th className="th">Dr/Cr</th><th className="th">GL account</th><th className="th">Description</th><th className="th">Cost object</th>
                <th className="th text-right">Debit (SGD)</th><th className="th text-right">Credit (SGD)</th>
              </tr></thead>
              <tbody>
                {p.lines.map((l, j) => (
                  <tr key={j} className="hover:bg-[var(--ecs-panel-2)]">
                    <td className="td"><span className={l.side === 'DR' ? 'pill-info' : 'pill-warn'}>{l.side}</span></td>
                    <td className="td font-mono text-xs">{l.glAccount}</td>
                    <td className="td">{l.description}</td>
                    <td className="td font-mono text-xs">{l.costObject ? `${l.costObject}${l.costObjectType ? ` (${l.costObjectType})` : ''}` : '—'}</td>
                    <td className="td text-right">{l.side === 'DR' ? fmtSgd(l.amountSgd) : ''}</td>
                    <td className="td text-right">{l.side === 'CR' ? fmtSgd(l.amountSgd) : ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t border-[var(--ecs-border)] font-semibold text-[var(--ecs-navy)]">
                <td className="td" colSpan={4}>Totals {p.balanced ? '· balanced' : '· OUT OF BALANCE'}</td>
                <td className="td text-right">{fmtSgd(p.lines.filter((l) => l.side === 'DR').reduce((s, l) => s + l.amountSgd, 0))}</td>
                <td className="td text-right">{fmtSgd(p.lines.filter((l) => l.side === 'CR').reduce((s, l) => s + l.amountSgd, 0))}</td>
              </tr></tfoot>
            </table>
          </div>
          <p className="text-xs text-[var(--ecs-muted)] mt-2">Gross {fmtSgd(p.grossSgd)} ({p.source}){p.taxSgd > 0 ? ` · incl. GST ${fmtSgd(p.taxSgd)} (${p.gstCode})` : ` · GST ${p.gstCode} (zero-rated)`} · debit split: {p.allocationNote}.</p>
        </Card>
      ))}

      <p className="text-xs text-[var(--ecs-muted)]">Preview of the proposed DD-31 behaviour (post CTA charges to SAP on receipt, not at claim). The debit cost object is the <strong>approved</strong> charging allocation; the credit GL is resolved from the CTA master. On cancellation/refund the entry auto-reverses. No postings are made from this screen.</p>
    </div>
  );
}

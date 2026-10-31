// DD-31 CTA Accounting Entries — the SAP GL journal each settled CTA charge posts on receipt from
// the TMC (not at claim). Flat line-item report: every Dr/Cr row carries its header context
// (request, TA, traveller, PNR, charge type, charged date, CTA account) and its posting lifecycle
// (posting date, status, SAP document), and is queryable via the filter bar.
import Link from 'next/link';
import { computeCtaPostings } from '@/modules/pretrip/ctaPosting';
import { fmtSgd } from '@/modules/pretrip/pricing';
import { PageTitle, Card, Empty } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function CtaPostingsPage({ searchParams }: { searchParams: Promise<{ q?: string; cta?: string; type?: string; status?: string; tax?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().toLowerCase();
  const ctaF = sp.cta ?? '';
  const typeF = sp.type ?? '';
  const statusF = sp.status ?? '';
  const taxF = sp.tax ?? '';

  const { postings } = await computeCtaPostings();
  const ctaOptions = [...new Set(postings.map((p) => p.ctaAccountId).filter((x): x is string => !!x))].sort();
  const statusOptions = [...new Set(postings.map((p) => p.postingStatus))].sort();
  const taxOptions = [...new Set(postings.map((p) => p.gstCode))].sort();

  const filtered = postings.filter((p) => {
    if (ctaF && p.ctaAccountId !== ctaF) return false;
    if (typeF && p.chargeType !== typeF) return false;
    if (statusF && p.postingStatus !== statusF) return false;
    if (taxF && p.gstCode !== taxF) return false;
    if (q && !`${p.requestNumber} ${p.authorisationNo ?? ''} ${p.travellerName} ${p.pnr ?? ''} ${p.invoiceNo ?? ''} ${p.sapDocNo ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });

  const rows = filtered.flatMap((p) => p.lines.map((l) => ({ p, l })));
  const totalDr = Math.round(rows.filter((r) => r.l.side === 'DR').reduce((s, r) => s + r.l.amountSgd, 0) * 100) / 100;
  const totalCr = Math.round(rows.filter((r) => r.l.side === 'CR').reduce((s, r) => s + r.l.amountSgd, 0) * 100) / 100;
  const balanced = Math.abs(totalDr - totalCr) < 0.005;
  const feedCount = filtered.filter((p) => p.feedSourced).length;
  const derivedCount = filtered.filter((p) => !p.feedSourced).length;
  const mismatchCount = filtered.filter((p) => p.gstMismatch).length;
  const active = q || ctaF || typeF || statusF || taxF;
  const statusPill = (s: string) => s === 'Posted' ? 'pill-pass' : s === 'Failed' ? 'pill-stop' : s === 'Reversed' ? 'pill-warn' : 'pill-info';

  return (
    <div className="w-full space-y-5">
      <PageTitle id="DD-31" title="CTA Accounting Entries"
        subtitle="The SAP GL journal each settled CTA charge posts on receipt from the TMC (not at claim). Each charge posts Dr expense (approved cost object) ⇄ Cr CTA clearing (credit GL), with its SAP document, posting date and status." />

      <Card title="How each entry is computed">
        <ul className="text-sm text-[var(--ecs-muted)] space-y-1.5 list-disc pl-5">
          <li><strong>Trigger.</strong> A charge posts to SAP on receipt, once the feed reports it <strong>settled</strong> on the CTA; a booked-but-pending charge does not post until settled.</li>
          <li><strong>Debit (expense).</strong> GL from the expense type, split across the <strong>approved charging allocation</strong> (CC/WBS × %, cross charge).</li>
          <li><strong>Tax code.</strong> Resolved from the expense type via the shared ECS ⇄ SAP GST logic: airfare <code>IZ</code> (zero-rated), hotel / car / visa <code>IO</code> (out-of-scope — no GST), agency / booking fee <code>I9</code> (9% claimable). The GST is extracted from the gross as the <strong>external tax amount</strong> and posts to the input-GST GL; the fee posts as its own line, never on the zero-rated airfare.</li>
          <li><strong>Credit (clearing).</strong> The <strong>credit GL</strong> of the charge&apos;s CTA account, from the CTA master — the full gross.</li>
          <li><strong>Driven from the feed.</strong> Each charge is the TMC&apos;s own per-charge breakdown (<code>Feed</code>): its expense type, SAP tax code and GST amount are posted verbatim, keyed by the invoice number. ECS re-derives the tax via its own logic and flags a <strong>GST mismatch</strong> (store-and-validate). A booking with no feed rows falls back to ECS-<code>Derived</code> amounts.</li>
          <li><strong>M6 entitlement differential (§13.19).</strong> When the traveller&apos;s policy group attracts M6, the airfare debit splits — the <strong>Economy base</strong> charges the approved cost object, and the <strong>M6 differential</strong> (Economy&nbsp;→&nbsp;entitled class) charges an <strong>M6 account</strong>. This is entitlement-based and automatic — not a travel-class upgrade (a class above entitlement is a separate policy exception).</li>
          <li><strong>Reversal.</strong> A cancellation reverses the <strong>refunded</strong> amount from the TMC feed; a non-refundable <strong>penalty</strong> stays posted, so the charge&apos;s net = the penalty.</li>
        </ul>
      </Card>

      <Card title="Filter">
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <div className="grow min-w-48">
            <label className="label">Search</label>
            <input name="q" defaultValue={sp.q ?? ''} placeholder="request · TA · traveller · PNR · SAP doc" className="field w-full" />
          </div>
          <div>
            <label className="label">CTA account</label>
            <select name="cta" defaultValue={ctaF} className="field w-44"><option value="">All</option>{ctaOptions.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          </div>
          <div>
            <label className="label">Charge type</label>
            <select name="type" defaultValue={typeF} className="field w-40"><option value="">All</option><option value="Airfare">Airfare</option><option value="Accommodation">Accommodation</option><option value="Fee">Fee</option></select>
          </div>
          <div>
            <label className="label">Posting status</label>
            <select name="status" defaultValue={statusF} className="field w-36"><option value="">All</option>{statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          </div>
          <div>
            <label className="label">Tax code</label>
            <select name="tax" defaultValue={taxF} className="field w-28"><option value="">All</option>{taxOptions.map((t) => <option key={t} value={t}>{t}</option>)}</select>
          </div>
          <button className="btn-primary">Apply</button>
          {active && <Link href="/finance/cta-postings" className="btn-ghost">Clear</Link>}
        </form>
      </Card>

      <div className="text-sm text-[var(--ecs-muted)]">
        {rows.length} line(s) · {filtered.length} charge(s){active ? ` (filtered from ${postings.length})` : ''} · <span className="pill-info">{feedCount} from feed</span> {derivedCount > 0 && <span className="pill-warn ml-1">{derivedCount} derived</span>} {mismatchCount > 0 && <span className="pill-stop ml-1">{mismatchCount} GST mismatch</span>} · total Dr {fmtSgd(totalDr)} = total Cr {fmtSgd(totalCr)} {balanced ? <span className="pill-pass ml-1">balanced</span> : <span className="pill-stop ml-1">out of balance</span>}
      </div>

      <Card title="Accounting entries (line items)">
        {rows.length === 0 ? <Empty>No CTA accounting entries match the filter.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead><tr>
                <th className="th">Request</th><th className="th">TA</th><th className="th">Traveller</th><th className="th">PNR</th><th className="th">Invoice</th><th className="th">Type</th><th className="th">Basis</th><th className="th">Tax code</th><th className="th text-right">Ext. tax</th><th className="th">Charged</th><th className="th">CTA acct</th>
                <th className="th">Posting date</th><th className="th">Status</th><th className="th">SAP doc</th>
                <th className="th">Dr/Cr</th><th className="th">GL account</th><th className="th">Description</th><th className="th">Cost object</th><th className="th text-right">Share %</th><th className="th text-right">Amount (SGD)</th>
              </tr></thead>
              <tbody>
                {rows.map(({ p, l }, i) => (
                  <tr key={i} className="hover:bg-[var(--ecs-panel-2)]">
                    <td className="td"><Link href={`/requests/${p.requestId}`} className="font-mono text-xs text-[var(--ecs-navy)] hover:underline">{p.requestNumber}</Link></td>
                    <td className="td font-mono text-xs">{p.authorisationNo ?? '—'}</td>
                    <td className="td">{p.travellerName}</td>
                    <td className="td font-mono text-xs">{p.pnr ?? '—'}</td>
                    <td className="td font-mono text-xs">{p.invoiceNo ?? '—'}</td>
                    <td className="td">{p.chargeType}{p.crossCharge && <span title="Cross-charged across cost objects" className="pill-info ml-1 text-[10px]">cross-charge</span>}</td>
                    <td className="td">{p.feedSourced ? <span className="pill-info" title="Posted from the TMC feed's own charge breakdown">Feed</span> : <span className="pill-warn" title="No feed charge rows — derived from fare/taxes/fees">Derived</span>}{p.gstMismatch && <span className="pill-stop ml-1" title={p.validationNote ?? 'Feed GST disagrees with ECS logic'}>⚠ GST</span>}</td>
                    <td className="td font-mono text-xs">{p.gstCode}</td>
                    <td className="td text-right">{p.taxSgd > 0 ? fmtSgd(p.taxSgd) : '—'}</td>
                    <td className="td">{p.chargeDate ?? '—'}</td>
                    <td className="td font-mono text-xs">{p.ctaAccountId ?? '—'}</td>
                    <td className="td">{p.postingDate ?? '—'}</td>
                    <td className="td"><span className={statusPill(p.postingStatus)}>{p.postingStatus}</span></td>
                    <td className="td font-mono text-xs">{p.sapDocNo ?? '—'}</td>
                    <td className="td"><span className={l.side === 'DR' ? 'pill-info' : 'pill-warn'}>{l.side}</span></td>
                    <td className="td font-mono text-xs">{l.glAccount}</td>
                    <td className="td whitespace-normal">{l.description}</td>
                    <td className="td font-mono text-xs">{l.costObject ? `${l.costObject}${l.costObjectType ? ` (${l.costObjectType})` : ''}` : '—'}</td>
                    <td className="td text-right">{l.percent != null ? `${l.percent}%` : ''}</td>
                    <td className="td text-right">{fmtSgd(l.amountSgd)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t border-[var(--ecs-border)] font-semibold text-[var(--ecs-navy)]">
                <td className="td" colSpan={19}>Total · Dr {fmtSgd(totalDr)} = Cr {fmtSgd(totalCr)} {balanced ? '· balanced' : '· OUT OF BALANCE'}</td>
                <td className="td text-right">{fmtSgd(totalDr)}</td>
              </tr></tfoot>
            </table>
          </div>
        )}
      </Card>

      <p className="text-xs text-[var(--ecs-muted)]">DD-31 — CTA charges post to SAP on receipt (not at claim). The debit cost object is the <strong>approved</strong> charging allocation; the credit GL is resolved from the CTA master. On cancellation/refund the entry auto-reverses.</p>
    </div>
  );
}

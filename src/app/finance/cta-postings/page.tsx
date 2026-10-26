// DD-31 (proposed) CTA Accounting Entries — a read-only PREVIEW of the SAP GL journal each settled
// CTA charge would post on receipt (not at claim). Flat line-item report: every Dr/Cr row carries
// its header context (request, TA, traveller, PNR, charge type, date, CTA account) and is
// queryable via the filter bar. The posting itself is not yet wired.
import Link from 'next/link';
import { computeCtaPostings } from '@/modules/pretrip/ctaPosting';
import { fmtSgd } from '@/modules/pretrip/pricing';
import { PageTitle, Card, Empty } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function CtaPostingsPage({ searchParams }: { searchParams: Promise<{ q?: string; cta?: string; type?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().toLowerCase();
  const ctaF = sp.cta ?? '';
  const typeF = sp.type ?? '';

  const { postings } = await computeCtaPostings();
  const ctaOptions = [...new Set(postings.map((p) => p.ctaAccountId).filter((x): x is string => !!x))].sort();

  const filtered = postings.filter((p) => {
    if (ctaF && p.ctaAccountId !== ctaF) return false;
    if (typeF && p.chargeType !== typeF) return false;
    if (q && !`${p.requestNumber} ${p.authorisationNo ?? ''} ${p.travellerName} ${p.pnr ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });

  const rows = filtered.flatMap((p) => p.lines.map((l) => ({ p, l })));
  const totalDr = Math.round(rows.filter((r) => r.l.side === 'DR').reduce((s, r) => s + r.l.amountSgd, 0) * 100) / 100;
  const totalCr = Math.round(rows.filter((r) => r.l.side === 'CR').reduce((s, r) => s + r.l.amountSgd, 0) * 100) / 100;
  const balanced = Math.abs(totalDr - totalCr) < 0.005;
  const active = q || ctaF || typeF;

  return (
    <div className="w-full space-y-5">
      <PageTitle id="DD-31 · preview" title="CTA Accounting Entries"
        subtitle="The SAP GL journal each settled CTA charge would post on receipt from the TMC (not at claim). Preview only — the posting is not yet wired; this report validates the entries and how they are computed." />

      <Card title="How each entry is computed">
        <ul className="text-sm text-[var(--ecs-muted)] space-y-1.5 list-disc pl-5">
          <li><strong>Trigger.</strong> Only charges the feed reports <strong>settled</strong> on the CTA; a booked-but-pending charge does not post until settled.</li>
          <li><strong>Debit (expense).</strong> GL from the expense type (airfare <code>GL-6110</code>, accommodation <code>GL-6120</code>), split across the <strong>approved charging allocation</strong> (CC/WBS × %), last line absorbing rounding. CTA air/hotel are <strong>ZP zero-rated</strong>, so no input-GST line.</li>
          <li><strong>Credit (clearing).</strong> The <strong>credit GL</strong> of the charge&apos;s CTA account, from the CTA master — the full gross (fare+taxes+fees, or hotel total).</li>
          <li><strong>Reversal.</strong> A later cancellation / refund posts the <strong>same entry reversed</strong> (auto-reversal).</li>
        </ul>
      </Card>

      {/* Query filter */}
      <Card title="Filter">
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <div className="grow min-w-48">
            <label className="label">Search</label>
            <input name="q" defaultValue={sp.q ?? ''} placeholder="request · TA · traveller · PNR" className="field w-full" />
          </div>
          <div>
            <label className="label">CTA account</label>
            <select name="cta" defaultValue={ctaF} className="field w-48">
              <option value="">All</option>
              {ctaOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Charge type</label>
            <select name="type" defaultValue={typeF} className="field w-44">
              <option value="">All</option>
              <option value="Airfare">Airfare</option>
              <option value="Accommodation">Accommodation</option>
            </select>
          </div>
          <button className="btn-primary">Apply</button>
          {active && <Link href="/finance/cta-postings" className="btn-ghost">Clear</Link>}
        </form>
      </Card>

      <div className="text-sm text-[var(--ecs-muted)]">
        {rows.length} line(s) · {filtered.length} charge(s){active ? ` (filtered from ${postings.length})` : ''} · total Dr {fmtSgd(totalDr)} = total Cr {fmtSgd(totalCr)} {balanced ? <span className="pill-pass ml-1">balanced</span> : <span className="pill-stop ml-1">out of balance</span>}
      </div>

      <Card title="Accounting entries (line items)">
        {rows.length === 0 ? <Empty>No CTA accounting entries match the filter.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead><tr>
                <th className="th">Request</th><th className="th">TA</th><th className="th">Traveller</th><th className="th">PNR</th>
                <th className="th">Type</th><th className="th">Charged</th><th className="th">CTA acct</th>
                <th className="th">Dr/Cr</th><th className="th">GL account</th><th className="th">Description</th><th className="th">Cost object</th><th className="th text-right">Share %</th>
                <th className="th text-right">Debit (SGD)</th><th className="th text-right">Credit (SGD)</th>
              </tr></thead>
              <tbody>
                {rows.map(({ p, l }, i) => (
                  <tr key={i} className="hover:bg-[var(--ecs-panel-2)]">
                    <td className="td"><Link href={`/requests/${p.requestId}`} className="font-mono text-xs text-[var(--ecs-navy)] hover:underline">{p.requestNumber}</Link></td>
                    <td className="td font-mono text-xs">{p.authorisationNo ?? '—'}</td>
                    <td className="td">{p.travellerName}</td>
                    <td className="td font-mono text-xs">{p.pnr ?? '—'}</td>
                    <td className="td">{p.chargeType}{p.crossCharge && <span title="Cross-charged across cost objects" className="pill-info ml-1 text-[10px]">cross-charge</span>}</td>
                    <td className="td">{p.chargeDate ?? '—'}</td>
                    <td className="td font-mono text-xs">{p.ctaAccountId ?? '—'}</td>
                    <td className="td"><span className={l.side === 'DR' ? 'pill-info' : 'pill-warn'}>{l.side}</span></td>
                    <td className="td font-mono text-xs">{l.glAccount}</td>
                    <td className="td whitespace-normal">{l.description}</td>
                    <td className="td font-mono text-xs">{l.costObject ? `${l.costObject}${l.costObjectType ? ` (${l.costObjectType})` : ''}` : '—'}</td>
                    <td className="td text-right">{l.percent != null ? `${l.percent}%` : ''}</td>
                    <td className="td text-right">{l.side === 'DR' ? fmtSgd(l.amountSgd) : ''}</td>
                    <td className="td text-right">{l.side === 'CR' ? fmtSgd(l.amountSgd) : ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t border-[var(--ecs-border)] font-semibold text-[var(--ecs-navy)]">
                <td className="td" colSpan={12}>Total {balanced ? '· balanced' : '· OUT OF BALANCE'}</td>
                <td className="td text-right">{fmtSgd(totalDr)}</td>
                <td className="td text-right">{fmtSgd(totalCr)}</td>
              </tr></tfoot>
            </table>
          </div>
        )}
      </Card>

      <p className="text-xs text-[var(--ecs-muted)]">Preview of the proposed DD-31 behaviour (post CTA charges to SAP on receipt, not at claim). The debit cost object is the <strong>approved</strong> charging allocation; the credit GL is resolved from the CTA master. On cancellation/refund the entry auto-reverses. No postings are made from this screen.</p>
    </div>
  );
}

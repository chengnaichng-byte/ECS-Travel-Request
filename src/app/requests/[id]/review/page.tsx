// TR-11 Review & Submit — consolidated request and declaration. Submit is disabled
// while any hard stop remains (AC06); the declaration is made by the requestor.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadRequest } from '@/modules/pretrip/queries';
import { getSettings } from '@/modules/pretrip/settings';
import { submitRequest } from '@/modules/pretrip/actions';
import { EcsReference, EcsIdentity } from '@/shared/ecs/services';
import { travellerName } from '@/modules/pretrip/traveller';
import { buildRoute } from '@/modules/pretrip/route';
import { employees } from '@/data/employees';
import { computeSummary, fmtSgd } from '@/modules/pretrip/pricing';
import { POLICY_OUTCOME, APPROVER_ROLE } from '@/shared/enums';
import { isHighRisk } from '@/modules/pretrip/risk';
import { bookingSummaryText } from '@/modules/pretrip/booking';
import { Card, KV, Stepper } from '@/components/ui';
import { OutcomePill } from '@/components/StatusPill';
import { HighRiskAdvisory } from '@/components/HighRiskAdvisory';

const ROUTE_ROLE_LABEL: Record<string, string> = {
  [APPROVER_ROLE.AdditionalApprover]: 'Additional Approver', [APPROVER_ROLE.FundingOwner]: 'Funding Owner / Cross-BA',
  [APPROVER_ROLE.Exception]: 'Exception Approver', [APPROVER_ROLE.DOA]: 'DOA', [APPROVER_ROLE.ResearchDOA]: 'Research DOA', [APPROVER_ROLE.RO]: 'RO',
};

export const dynamic = 'force-dynamic';

function fmtDate(d: Date | null) { return d ? d.toISOString().slice(0, 10) : '—'; }

export default async function ReviewStep({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const req = await loadRequest(id);
  if (!req) notFound();
  const settings = await getSettings();
  const summary = computeSummary(req.expenses, settings.approvalAmountBasis);
  const hardStops = req.policyChecks.filter((c) => c.outcome === POLICY_OUTCOME.HardStop);
  const exceptions = req.policyChecks.filter((c) => c.outcome === POLICY_OUTCOME.Exception);
  const canSubmit = hardStops.length === 0;
  // §12 personal travel — present if a personal extension window or a personal leg exists.
  const hasPersonal = !!req.personalStart || req.legs.some((l) => l.isPersonal);
  const personalCost = req.expenses.filter((e) => e.accommodation).reduce((s, e) => s + (e.accommodation!.personalNights || 0) * e.accommodation!.budgetedNightly, 0);
  // §4.8 high-risk destination — the traveller must acknowledge before submission
  // (enforced by the required checkbox below and re-checked server-side on submit).
  const highRisk = isHighRisk(req);

  // §21 dynamic approval-route preview — derived from the request's CURRENT charging, cost,
  // exceptions and saved Additional Approver, so it reflects edits as the request changes.
  const previewSteps = buildRoute(req, {
    exceptionApproverRequired: settings.exceptionApproverRequired,
    sameRouteResearch: settings.sameRouteResearch,
    approvalAmount: summary.approvalAmount,
    hasException: exceptions.length > 0,
    crossBaThresholdSgd: settings.crossBaThresholdSgd,
    roRequirement: settings.roRequirement,
  });

  return (
    <div>
      <Stepper id={id} active="review" />

      <HighRiskAdvisory req={req} />

      <div className="grid md:grid-cols-2 gap-5">
        <Card title="Trip">
          <dl className="grid grid-cols-2 gap-3">
            <KV label="Purpose">{EcsReference.travelPurpose(req.purposeId ?? '')?.name}</KV>
            <KV label="Destination">{EcsReference.city(req.destCity ?? '')?.name}, {EcsReference.country(req.destCountry ?? '')?.name}</KV>
            <KV label="Dates">{fmtDate(req.startDate)} → {fmtDate(req.endDate)}</KV>
            <KV label="Travel class">{EcsReference.travelClass(req.travelClassId ?? '')?.name}</KV>
            <KV label="Booking arrangement">{bookingSummaryText(req.bookingArrangement, req.bookingMethod)}</KV>
            {(req.eventStartDate || req.eventEndDate) && <KV label="Event dates">{fmtDate(req.eventStartDate)} → {fmtDate(req.eventEndDate)}</KV>}
            {req.invitationRef && <KV label="Invitation ref">{req.invitationRef}</KV>}
            {req.visaLetterRequired && <KV label="Visa letter">Required (§4.13)</KV>}
            <KV label="Traveller">{travellerName(req)}</KV>
          </dl>
        </Card>
        <Card title="Charging">
          <table className="w-full text-sm">
            <tbody>
              {req.allocations.map((a) => (
                <tr key={a.id} className="border-b border-[var(--ecs-border)] last:border-0">
                  <td className="py-1.5">{a.chargingCode}</td>
                  <td className="py-1.5 text-xs text-[var(--ecs-muted)]">{EcsReference && a.isResearch ? 'Research' : 'Non-research'}</td>
                  <td className="py-1.5 text-right">{a.percent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card title="Estimated Costs" className="mt-5">
        <table className="w-full text-sm">
          <tbody>
            {req.expenses.map((e) => (
              <tr key={e.id} className="border-b border-[var(--ecs-border)] last:border-0">
                <td className="py-1.5">{EcsReference.expenseType(e.expenseTypeId)?.name}</td>
                <td className="py-1.5 text-right">{fmtSgd(e.sgdAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="mt-3 space-y-1 text-sm max-w-xs ml-auto">
          <div className="flex justify-between"><dt className="text-[var(--ecs-muted)]">Gross</dt><dd>{fmtSgd(summary.gross)}</dd></div>
          <div className="flex justify-between"><dt className="text-[var(--ecs-muted)]">Less sponsorship</dt><dd>− {fmtSgd(summary.sponsorship)}</dd></div>
          <div className="flex justify-between font-semibold text-[var(--ecs-navy-2)]"><dt>Estimated NTU-funded</dt><dd>{fmtSgd(summary.ntuFunded)}</dd></div>
          <div className="flex justify-between"><dt className="text-[var(--ecs-muted)]">Approval amount ({settings.approvalAmountBasis})</dt><dd>{fmtSgd(summary.approvalAmount)}</dd></div>
        </dl>
      </Card>

      <Card title="Approval Route Preview (§21)" className="mt-5">
        <p className="text-xs text-[var(--ecs-muted)] mb-3">Derived from the current charging, cost, policy exceptions and any saved Additional Approver. The final route is fixed at submission.</p>
        <div className="flex items-center gap-1 flex-wrap text-sm">
          <span className="pill-info">Traveller</span>
          {previewSteps.map((s) => (
            <span key={s.seq} className="flex items-center gap-1">
              <span className="text-[var(--ecs-muted)]">→</span>
              <span className="pill-navy">{ROUTE_ROLE_LABEL[s.roleType] ?? s.roleType}: {EcsIdentity.employee(s.approverId ?? '')?.name ?? 'TBD'}</span>
            </span>
          ))}
        </div>
        {previewSteps.some((s) => s.note) && (
          <ul className="mt-2 text-xs text-[var(--ecs-muted)] space-y-0.5">
            {previewSteps.filter((s) => s.note).map((s) => <li key={s.seq}>• {ROUTE_ROLE_LABEL[s.roleType] ?? s.roleType}: {s.note}</li>)}
          </ul>
        )}
      </Card>

      {(hardStops.length > 0 || exceptions.length > 0) && (
        <Card title="Outstanding policy items" className="mt-5">
          <ul className="space-y-2">
            {[...hardStops, ...exceptions].map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-sm"><OutcomePill outcome={c.outcome} /> {c.label} — <span className="text-[var(--ecs-muted)]">{c.detail}</span></li>
            ))}
          </ul>
        </Card>
      )}

      {hasPersonal && (
        <Card title="Personal Travel (§12)" className="mt-5">
          <p className="text-sm text-[var(--ecs-muted)]">
            This trip includes a personal extension{req.personalStart ? ` (${fmtDate(req.personalStart)} → ${fmtDate(req.personalEnd)})` : ''}. Personal days are excluded from ODA and personal nights from the accommodation budget (§4.5). Estimated incremental personal cost borne by the traveller: <strong>{fmtSgd(personalCost)}</strong>{personalCost === 0 ? ' (no chargeable personal nights captured)' : ''}.
          </p>
        </Card>
      )}

      <Card title="Declaration" className="mt-5">
        <p className="text-sm text-[var(--ecs-muted)] mb-3">{settings.declarationText} Approval, entitlements and declarations derive from the traveller (§13.13).</p>
        <form action={submitRequest.bind(null, id)} className="space-y-4">
          <div className="max-w-md">
            <label className="label" htmlFor="additionalApproverId">Additional Approver (optional)</label>
            <select id="additionalApproverId" name="additionalApproverId" defaultValue={req.additionalApproverId ?? ''} className="field">
              <option value="">— none —</option>
              {employees.filter((e) => e.id !== req.travellerId).map((e) => <option key={e.id} value={e.id}>{e.name} — {e.title}</option>)}
            </select>
            <p className="text-xs text-[var(--ecs-muted)] mt-1">Optionally route the request through one additional approver of your choice before the DOA (§23). You cannot select yourself.</p>
          </div>
          {highRisk && (
            <label className="flex items-start gap-2 text-sm text-red-900 bg-red-50 border border-red-200 rounded p-2">
              <input type="checkbox" name="highRiskAck" value="on" required className="mt-0.5 w-4 h-4" defaultChecked={req.highRiskAck} />
              <span>I acknowledge the high-risk travel advisory for this destination, accept the associated risks, and confirm I will comply with the University&apos;s travel risk-management requirements (§4.8).</span>
            </label>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="coiAck" value="on" className="mt-0.5 w-4 h-4" defaultChecked />
            <span>{settings.coiText}</span>
          </label>
          {hasPersonal && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="personalAck" value="on" className="mt-0.5 w-4 h-4" defaultChecked={req.personalAck} />
              <span>I acknowledge the personal portion of this trip is at my own cost and does not form part of the NTU-funded estimate (§12).</span>
            </label>
          )}
          <div className="flex items-center justify-between gap-4">
            <Link href={`/requests/${id}/policy`} className="btn-secondary">← Back</Link>
            <div className="flex items-center gap-3">
              {!canSubmit && <span className="text-sm text-red-700">Resolve {hardStops.length} hard stop(s) before submitting.</span>}
              <button type="submit" disabled={!canSubmit} className="btn-primary">Submit for Approval</button>
            </div>
          </div>
        </form>
      </Card>
    </div>
  );
}

// TR-11 Review & Submit — consolidated request and declaration. Submit is disabled
// while any hard stop remains (AC06); the declaration is made by the requestor.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadRequest } from '@/modules/pretrip/queries';
import { getSettings } from '@/modules/pretrip/settings';
import { submitRequest, addAttachment, attachNamedFile } from '@/modules/pretrip/actions';
import { NON_TERM_APPROVAL_DOC } from '@/modules/pretrip/nonTerm';
import { EMERGENCY_APPROVAL_DOC, emergencyMethodAllowed, withinEmergencyWindow, leadTimeDays, EMERGENCY_OOW_MIN_JUSTIFICATION } from '@/modules/pretrip/emergency';
import { EcsReference, EcsIdentity } from '@/shared/ecs/services';
import { travellerName } from '@/modules/pretrip/traveller';
import { buildRoute, doaCandidatesFor, isResearchRequest } from '@/modules/pretrip/route';
import { getActiveWorkflowScenario } from '@/modules/pretrip/workflowConfig';
import { resolveTmcProvider } from '@/modules/pretrip/tmcRouting';
import { employees } from '@/data/employees';
import { computeSummary, fmtSgd } from '@/modules/pretrip/pricing';
import { POLICY_OUTCOME, APPROVER_ROLE } from '@/shared/enums';
import { isHighRisk } from '@/modules/pretrip/risk';
import { findDuplicateRequests } from '@/modules/pretrip/duplicates';
import { bookingsForAuthorisation, legPnrMap } from '@/modules/pretrip/tmcRetrieval';
import { bookingSummaryText, isTmcArrangement } from '@/modules/pretrip/booking';
import { CostItems, CostAllocationCard } from '@/components/ReviewSections';
import { ReviewRoute } from '@/components/ReviewRoute';
import { Card, KV, Stepper } from '@/components/ui';
import { OutcomePill } from '@/components/StatusPill';
import { HighRiskAdvisory } from '@/components/HighRiskAdvisory';

const ROUTE_ROLE_LABEL: Record<string, string> = {
  [APPROVER_ROLE.AdditionalApprover]: 'Additional Approver',
  [APPROVER_ROLE.Exception]: 'Exception Approver', [APPROVER_ROLE.DOA]: 'DOA', [APPROVER_ROLE.ResearchDOA]: 'Research DOA', [APPROVER_ROLE.RO]: 'RO',
};

export const dynamic = 'force-dynamic';

function fmtDate(d: Date | null) { return d ? d.toISOString().slice(0, 10) : '—'; }

export default async function ReviewStep({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const { error } = await searchParams;
  const req = await loadRequest(id);
  if (!req) notFound();
  const settings = await getSettings();
  const summary = computeSummary(req.expenses, settings.approvalAmountBasis);
  const hardStops = req.policyChecks.filter((c) => c.outcome === POLICY_OUTCOME.HardStop);
  const exceptions = req.policyChecks.filter((c) => c.outcome === POLICY_OUTCOME.Exception);
  // §13.x duplicate / overlap warning — a true duplicate (same destination) hard-blocks submit;
  // a date clash with a different destination is surfaced as a softer notice.
  const duplicates = await findDuplicateRequests(req);
  const dupBlocking = duplicates.filter((d) => d.sameDestination);
  const dupClashes = duplicates.filter((d) => !d.sameDestination);
  const canSubmit = hardStops.length === 0 && dupBlocking.length === 0;
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
    roRequirement: settings.roRequirement,
    researchPiSelfApproval: settings.researchPiSelfApproval,
    selfApprovalLimitSgd: settings.selfApprovalLimitSgd,
    workflowScenario: await getActiveWorkflowScenario(),
  });
  // §13.14 the DOA is traveller-selected (never pre-selected). Fixed middle steps (RO /
  // Funding Owner / Exception) are resolved server-side; the chevron visual adds the chosen
  // Additional Approver and DOA.
  const isDoaRole = (rt: string) => rt === APPROVER_ROLE.DOA || rt === APPROVER_ROLE.ResearchDOA;
  const fixedSteps = previewSteps
    .filter((s) => s.roleType !== APPROVER_ROLE.AdditionalApprover && !isDoaRole(s.roleType))
    .map((s) => ({ label: ROUTE_ROLE_LABEL[s.roleType] ?? s.roleType, name: EcsIdentity.employee(s.approverId ?? '')?.name ?? 'TBD' }));
  const doaStep = previewSteps.find((s) => isDoaRole(s.roleType));
  const doaRoleLabel = doaStep?.roleType === APPROVER_ROLE.ResearchDOA ? 'Research DOA' : 'DOA';
  const doaCandidates = doaCandidatesFor(req, { approvalAmount: summary.approvalAmount, sameRouteResearch: settings.sameRouteResearch });
  // §13.x / DD-23 emergency authorising officers — senior, non-traveller staff.
  const emergencyAuthorisers = employees.filter((e) => !e.isTraveller && e.travelPolicyGroup === 'SENIOR' && e.id !== req.travellerId);
  const emergencyApprovals = req.attachments.filter((a) => a.docType === EMERGENCY_APPROVAL_DOC);
  // §13.x / DD-23 emergency-lane gates: the book-first lane needs an agent-assisted / offline TMC
  // booking, and raising it outside the configured lead-time window is soft-gated.
  const emergencyMethodOk = emergencyMethodAllowed(req);
  const emergencyLeadDays = leadTimeDays(req);
  const emergencyOutsideWindow = !withinEmergencyWindow(req, settings.emergencyLeadDays);
  // §13.x Non-term research travel — available only when the trip is on a research WBS (offline
  // approval already exists for research-funded travel). Evidence is the attached approval e-mail.
  const nonTermAvailable = isResearchRequest(req);
  const nonTermApprovals = req.attachments.filter((a) => a.docType === NON_TERM_APPROVAL_DOC);
  const additionalCandidates = employees.filter((e) => e.id !== req.travellerId).map((e) => ({ id: e.id, name: e.name, title: e.title }));
  const research = isResearchRequest(req) && !settings.sameRouteResearch;
  const tmcText = isTmcArrangement(req.bookingArrangement) ? resolveTmcProvider(req).provider.name : 'Not via a TMC';

  // §4.4/§13.20 full itinerary for the Trip card — shown when the route is more than a single
  // destination (multi-city) or carries a personal segment, so the whole route is visible at
  // the top without relying on the Airfare cost line.
  const sharedLegs = req.legs.filter((l) => !l.travellerId).sort((a, b) => a.seq - b.seq);
  const routeText = sharedLegs.length ? [sharedLegs[0].originCode, ...sharedLegs.map((l) => l.destCode)].join(' → ') : '';
  // DD-17 PNR provenance on the TR: the TA-keyed booking set (all PNRs under this authorisation)
  // plus the per-leg PNR mapping, shown once the request is booked.
  const bookingSet = bookingsForAuthorisation(req);
  const legPnr = legPnrMap(req);

  return (
    <div>
      <Stepper id={id} active="review" requestNumber={req.requestNumber} status={req.status} />
      {error && <div className="card p-3 mb-4 text-sm text-red-800 bg-red-50 border-red-200">{error}</div>}
      {dupBlocking.length > 0 && (
        <div className="card p-3 mb-4 text-sm text-red-800 bg-red-50 border-red-200">
          <b>Duplicate travel request.</b> An active request already covers this trip — submission is blocked until you cancel or amend it:
          <ul className="list-disc pl-5 mt-1">
            {dupBlocking.map((d) => (
              <li key={d.requestNumber}><Link href={`/requests?find=${d.requestNumber}`} className="underline">{d.requestNumber}</Link> ({d.status}) — {d.destination}, {d.dates}</li>
            ))}
          </ul>
        </div>
      )}
      {dupClashes.length > 0 && (
        <div className="card p-3 mb-4 text-sm text-amber-900 bg-amber-50 border-amber-200">
          <b>Overlapping dates.</b> This traveller has another active request with overlapping dates (different destination) — check this is not a double-booking: {dupClashes.map((d) => `${d.requestNumber} (${d.destination}, ${d.dates})`).join('; ')}.
        </div>
      )}
      <HighRiskAdvisory req={req} />

      <form action={submitRequest.bind(null, id)} className="space-y-5">
        {/* §21 Approval route (visual) — above the Trip section, with the DOA selector. */}
        <ReviewRoute
          research={research}
          fixedSteps={fixedSteps}
          doaRoleLabel={doaRoleLabel}
          doaCandidates={doaCandidates}
          additionalCandidates={additionalCandidates}
          initialDoa={req.selectedDoaId || (doaCandidates.length === 1 ? doaCandidates[0].id : '')}
          initialAdditional={req.additionalApproverId ?? ''}
        />

        <div className="grid md:grid-cols-2 gap-5">
          <Card title="Trip">
            <dl className="grid grid-cols-2 gap-3">
              <KV label="Purpose">{EcsReference.travelPurpose(req.purposeId ?? '')?.name}</KV>
              <KV label="Destination">{EcsReference.city(req.destCity ?? '')?.name}, {EcsReference.country(req.destCountry ?? '')?.name}</KV>
              <KV label="Dates">{fmtDate(req.startDate)} → {fmtDate(req.endDate)}</KV>
              {req.isGroup ? (
                <KV label="Travel class">Each traveller flies at their own class entitlement (§13.14) — per-traveller classes are shown in the cost items below.</KV>
              ) : (
                <KV label="Travel class">{EcsReference.travelClass(req.travelClassId ?? '')?.name}</KV>
              )}
              <KV label="Booking arrangement">{bookingSummaryText(req.bookingArrangement, req.bookingMethod)}</KV>
              <KV label="TMC">{tmcText}</KV>
              {(req.eventStartDate || req.eventEndDate) && <KV label="Event dates">{fmtDate(req.eventStartDate)} → {fmtDate(req.eventEndDate)}</KV>}
              {req.invitationRef && <KV label="Invitation ref">{req.invitationRef}</KV>}
              {req.visaLetterRequired && <KV label="Visa letter">Required (§4.13)</KV>}
              <KV label="Traveller">{travellerName(req)}</KV>
            </dl>
            {/* DD-17 Booking reference(s) — TR-level provenance (one TR → N PNRs). */}
            {bookingSet.pnrCount > 0 && (
              <div className="mt-3 pt-3 border-t border-[var(--ecs-border)]">
                <div className="text-xs font-semibold text-[var(--ecs-muted)] mb-1">Booking reference{bookingSet.pnrCount > 1 ? `s · ${bookingSet.pnrCount} PNRs` : ''}</div>
                <ul className="space-y-1 text-xs text-[var(--ecs-muted)]">
                  {bookingSet.bookings.map((b, i) => (
                    <li key={i}>
                      <span className="font-mono text-[var(--ecs-navy)]">{b.pnr ?? '—'}</span>
                      {b.ticketNo ? ` · ${b.ticketNo}` : ''}
                      {req.isGroup && b.travellerId ? ` · ${EcsIdentity.employee(b.travellerId)?.name ?? b.travellerId}` : ''}
                      {` · ${b.status}`}
                      {b.totalSgd ? ` · ${fmtSgd(b.totalSgd)}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
          {/* Itinerary — the full route sits beside the Trip card; charging moves below the cost
              items (ECS "Cost Allocation" format). Shown whenever the request has shared legs. */}
          <Card title="Itinerary">
            {sharedLegs.length > 0 ? (
              <>
                <div className="text-sm font-medium mb-2">{routeText}</div>
                <ul className="space-y-1 text-xs text-[var(--ecs-muted)]">
                  {sharedLegs.map((l, i) => (
                    <li key={l.id}>
                      Leg {i + 1}: {l.originCode} → {l.destCode}
                      {l.departDate ? ` · ${fmtDate(l.departDate)}` : ''}
                      {l.nights ? ` · ${l.nights} night${l.nights > 1 ? 's' : ''}` : ''}
                      {l.isPersonal ? <span className="ml-1 pill-navy">Personal</span> : ''}
                      {legPnr[l.id] ? <span className="ml-1 pill-info" title="Ticketed on this PNR">{legPnr[l.id]}</span> : ''}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-[var(--ecs-muted)]">No itinerary legs captured for this request.</p>
            )}
          </Card>
        </div>

        <CostItems req={req} summary={summary} basis={settings.approvalAmountBasis} />

        {/* Charging — beneath the cost items, in the full ECS Cost Allocation format. */}
        <CostAllocationCard req={req} amount={summary.ntuFunded} />

        {(hardStops.length > 0 || exceptions.length > 0) && (
          <Card title="Outstanding policy items">
            <ul className="space-y-2">
              {[...hardStops, ...exceptions].map((c) => (
                <li key={c.id} className="flex items-center gap-2 text-sm"><OutcomePill outcome={c.outcome} /> {c.label} — <span className="text-[var(--ecs-muted)]">{c.detail}</span></li>
              ))}
            </ul>
          </Card>
        )}

        {hasPersonal && (
          <Card title="Personal Travel (§12)">
            <p className="text-sm text-[var(--ecs-muted)]">
              This trip includes a personal extension{req.personalStart ? ` (${fmtDate(req.personalStart)} → ${fmtDate(req.personalEnd)})` : ''}. Personal days are excluded from ODA and personal nights from the accommodation budget (§4.5). Estimated incremental personal cost borne by the traveller: <strong>{fmtSgd(personalCost)}</strong>{personalCost === 0 ? ' (no chargeable personal nights captured)' : ''}.
            </p>
          </Card>
        )}

        {/* §13.x / DD-23 Emergency lane (book first, raise later) — bounded, audited. */}
        <details className="group card p-0 overflow-hidden" open={req.isEmergency}>
          <summary className="px-4 py-3 cursor-pointer select-none flex items-center gap-2 font-semibold text-[var(--ecs-navy)] list-none">
            <span className="transition-transform group-open:rotate-90">▸</span> Emergency lane — book first, raise later (DD-23)
            {req.isEmergency
              ? <span className="pill-exc ml-1">In use</span>
              : emergencyMethodOk
                ? <span className="ml-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#e8f3ec] text-[#2f7d4f]">Available</span>
                : <span className="ml-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-[var(--ecs-panel)] text-[var(--ecs-muted)] border border-[var(--ecs-border)]">Not available · needs agent-assisted / offline booking</span>}
            {req.isEmergency && req.emergencyOutsideWindow && <span className="pill-warn ml-1">Outside standard window</span>}
          </summary>
          <div className="px-4 pb-4 space-y-3 border-t border-[var(--ecs-border)] pt-3">
            <p className="text-xs text-[var(--ecs-muted)]">A bounded, audited lane for urgent travel — <strong>book first, raise/approve later</strong>. It lets the trip be <strong>booked (or already booked) before approval</strong> on a named officer&apos;s authority, but the <strong>full approval workflow still runs, retrospectively</strong> — it changes the timing of approval, not who approves. Requires a justification, a named authorising officer and the authorising e-mail; available only for TMC agent-assisted / offline bookings.</p>

            {!emergencyMethodOk ? (
              <div className="text-sm rounded border border-[#f59e0b] bg-[#fff8ec] p-3">
                <strong>Emergency lane unavailable for this booking method.</strong> The current booking is <em>{bookingSummaryText(req.bookingArrangement, req.bookingMethod)}</em>. The book-first lane needs a human agent to hold or place the booking ahead of approval, so it is offered only for <strong>TMC agent-assisted</strong> or <strong>offline</strong> bookings. Change the booking method on the <Link href={`/requests/${id}/trip`} className="underline">Trip step</Link> to use it.
              </div>
            ) : (
              <>
                {emergencyOutsideWindow && (
                  <div className="text-sm rounded border border-[#f97316] bg-[#fff3e8] p-3">
                    <strong>Outside the standard {settings.emergencyLeadDays}-day window.</strong> The earliest departure is about <strong>{emergencyLeadDays ?? '—'} day(s)</strong> away — there is normally time for the standard lane. You may still use the emergency lane, but a <strong>detailed justification</strong> (at least {EMERGENCY_OOW_MIN_JUSTIFICATION} characters) and the confirmation below are required, and the request will be flagged <span className="pill-warn">Outside standard window</span> to the approver.
                  </div>
                )}
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="emergency" value="on" defaultChecked={req.isEmergency} className="mt-0.5 w-4 h-4" />
                  <span>Use the <strong>emergency lane</strong> (book first, raise later) for this request.</span>
                </label>
                <div className="pl-6">
                  <label className="label">Authorising officer (records who authorised the emergency)</label>
                  <select name="emergencyAuthoriserId" defaultValue={req.emergencyAuthoriserId ?? ''} className="field w-96 max-w-full">
                    <option value="">— select an authorising officer —</option>
                    {emergencyAuthorisers.map((e) => <option key={e.id} value={e.id}>{e.name} · {e.title}</option>)}
                  </select>
                </div>
                <div className="pl-6">
                  <label className="label">Emergency justification{emergencyOutsideWindow && <span className="text-[var(--ecs-red)]"> * (detailed — at least {EMERGENCY_OOW_MIN_JUSTIFICATION} characters)</span>}</label>
                  <textarea name="emergencyJustification" defaultValue={req.emergencyJustification ?? ''} rows={emergencyOutsideWindow ? 3 : 2} className="field w-full" placeholder="e.g. same-day flight to an urgent funder meeting; TMC held space pending authorisation." />
                </div>
                {emergencyOutsideWindow && (
                  <label className="pl-6 flex items-start gap-2 text-sm">
                    <input type="checkbox" name="emergencyOutOfWindowAck" value="on" defaultChecked={req.emergencyOutsideWindow} className="mt-0.5 w-4 h-4" />
                    <span>I confirm this is a genuine emergency despite the {emergencyLeadDays ?? '—'}-day lead time, and the standard lane is not feasible.</span>
                  </label>
                )}
                {/* Mandatory email-approval attachment for the emergency lane. This uses the request's
                    attachment store via a button formAction, so it does not nest a form inside submit. */}
                <div className="pl-6">
                  <label className="label">Email approval <span className="text-[var(--ecs-red)]">*</span> — attach the authorising officer&apos;s e-mail (PDF/PNG/JPEG)</label>
                  {emergencyApprovals.length > 0 ? (
                    <ul className="text-xs mb-1 space-y-0.5">
                      {emergencyApprovals.map((a) => <li key={a.id} className="flex items-center gap-2"><span className="pill-pass">Attached</span> {a.fileName} <span className="text-[var(--ecs-muted)]">({a.sizeKb} KB)</span></li>)}
                    </ul>
                  ) : (
                    <p className="text-xs text-[var(--ecs-red)] mb-1">Required for the emergency lane — attach the authorising e-mail before submitting.</p>
                  )}
                  <div className="flex items-center gap-2">
                    <input type="file" name="file" accept="application/pdf,image/png,image/jpeg" className="text-xs" />
                    <input type="hidden" name="docType" value={EMERGENCY_APPROVAL_DOC} />
                    <button formAction={addAttachment.bind(null, id)} className="btn-secondary text-xs">Attach email approval</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </details>

        {/* §13.x Non-term research travel — offline-approval attestation (research WBS only). Same
            available / not-available signalling as the emergency lane, with an inline email attach. */}
        <details className="group card p-0 overflow-hidden" open={req.nonTermDeclared || nonTermAvailable}>
          <summary className="px-4 py-3 cursor-pointer select-none flex items-center gap-2 font-semibold text-[var(--ecs-navy)] list-none">
            <span className="transition-transform group-open:rotate-90">▸</span> Non-term research travel — offline approval
            {req.nonTermDeclared
              ? <span className="pill-exc ml-1">Attested</span>
              : nonTermAvailable
                ? <span className="ml-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#e8f3ec] text-[#2f7d4f]">Available</span>
                : <span className="ml-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-[var(--ecs-panel)] text-[var(--ecs-muted)] border border-[var(--ecs-border)]">Not available · research-funded travel only</span>}
          </summary>
          <div className="px-4 pb-4 space-y-3 border-t border-[var(--ecs-border)] pt-3">
            <p className="text-xs text-[var(--ecs-muted)]">When a <strong>research-funded</strong> trip takes place in <strong>non-term time</strong>, the required approval has already been obtained offline. Attest below and attach the approval e-mail; where enabled in the workflow configuration, this fast-tracks the pre-trip approval. Available only for trips charged to a <strong>research WBS</strong>.</p>
            {!nonTermAvailable ? (
              <div className="text-sm rounded border border-[var(--ecs-border)] bg-[var(--ecs-panel)] p-3 text-[var(--ecs-muted)]">
                <strong className="text-[var(--ecs-text)]">Available for research-funded travel only.</strong> This trip is not charged to a research WBS. Charge it to a research cost object on the <Link href={`/requests/${id}/charging`} className="underline">Charging step</Link> to use this.
              </div>
            ) : (
              <>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="nonTerm" value="on" defaultChecked={req.nonTermDeclared} className="mt-0.5 w-4 h-4" />
                  <span>This trip is in <strong>non-term time</strong> and the required <strong>offline approval has already been obtained</strong>.</span>
                </label>
                <div className="pl-6">
                  <label className="label">Offline approval e-mail <span className="text-[var(--ecs-red)]">*</span> — attach the approving e-mail (PDF/PNG/JPEG)</label>
                  {nonTermApprovals.length > 0 ? (
                    <ul className="text-xs mb-1 space-y-0.5">
                      {nonTermApprovals.map((a) => <li key={a.id} className="flex items-center gap-2"><span className="pill-pass">Attached</span> {a.fileName} <span className="text-[var(--ecs-muted)]">({a.sizeKb} KB)</span></li>)}
                    </ul>
                  ) : (
                    <p className="text-xs text-[var(--ecs-muted)] mb-1">Attach the approval e-mail that supports this attestation.</p>
                  )}
                  <div className="flex items-center gap-2">
                    <input type="file" name="nonTermEmail" accept="application/pdf,image/png,image/jpeg" className="text-xs" />
                    <button formAction={attachNamedFile.bind(null, id, 'nonTermEmail', NON_TERM_APPROVAL_DOC)} className="btn-secondary text-xs">Attach approval e-mail</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </details>

        <Card title="Declaration">
          <p className="text-sm text-[var(--ecs-muted)] mb-3">{settings.declarationText} Approval, entitlements and declarations derive from the traveller (§13.13).</p>
          <div className="space-y-4">
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
          </div>
        </Card>
      </form>
    </div>
  );
}

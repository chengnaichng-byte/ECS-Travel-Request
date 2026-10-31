// TR-11 Review & Submit — consolidated request and declaration. Submit is disabled
// while any hard stop remains (AC06); the declaration is made by the requestor.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadRequest } from '@/modules/pretrip/queries';
import { getSettings } from '@/modules/pretrip/settings';
import { submitRequest, addAttachment, attachNamedFile, runPolicy, resolveJustifications } from '@/modules/pretrip/actions';
import { canEditRequest } from '@/modules/pretrip/guards';
import { currentPersonaId } from '@/shared/session';
import { travelClasses } from '@/data/travelClass';
import { REQUEST_STATUS } from '@/shared/enums';
import { NON_TERM_APPROVAL_DOC } from '@/modules/pretrip/nonTerm';
import { EMERGENCY_APPROVAL_DOC, emergencyMethodAllowed, withinEmergencyWindow, leadTimeDays, EMERGENCY_OOW_MIN_JUSTIFICATION } from '@/modules/pretrip/emergency';
import { EcsReference, EcsIdentity, EcsTravelClassRegister } from '@/shared/ecs/services';
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
  // §13.19 the travel-class exception drives the "above entitlement" marker on the Trip card; the full
  // exception list (hotel cap + travel class) shows in the side-by-side Policy Exceptions card.
  const classException = exceptions.find((c) => c.code === 'CLASS');
  const proposedClassName = EcsReference.travelClass(req.travelClassId ?? '')?.name ?? '—';
  // §6.3 Policy Review is merged into this step — the checks, the inline "resolve justifications" and
  // "re-run checks" live here, alongside the final declaration and submit.
  const canEdit = canEditRequest(await currentPersonaId(), req) && (req.status === REQUEST_STATUS.Draft || req.status === REQUEST_STATUS.SentBack);
  const className = (cid?: string | null) => travelClasses.find((c) => c.id === cid)?.name ?? cid ?? '';
  const cityName = (code: string) => EcsReference.city(code)?.name ?? code;
  const needClassJustification = req.policyChecks.some((c) => c.code === 'CLASS_JUSTIFY');
  const aboveCapHotels = req.expenses.filter((e) => e.accommodation && e.accommodation.exceptionOutcome === POLICY_OUTCOME.Exception && !(e.notes ?? '').trim());
  const canResolve = canEdit && (needClassJustification || aboveCapHotels.length > 0);
  const entitledClassName = EcsReference.travelClass(req.entitledClassId ?? '')?.name ?? null;
  const policyGroupCode = !req.isGroup ? EcsTravelClassRegister.policyGroup(req.travellerId, req.startDate ?? new Date()) : null;
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

      {/* §6.3 Policy checks — re-run + resolve justifications inline (merged from the Policy Review step).
          These sit OUTSIDE the Submit form so they are not nested forms. */}
      <div className="flex justify-end mb-3">
        <form action={runPolicy.bind(null, id)}><button className="btn-secondary">Re-run checks</button></form>
      </div>
      {canResolve && (
        <Card title="Resolve to submit — justification required" className="mb-4">
          <p className="text-xs text-[var(--ecs-muted)] mb-3">Enter the justification for each item below and save. The checks re-run and these hard stops clear without leaving this page. Exceptions still route to an approver.</p>
          <form action={resolveJustifications.bind(null, id)} className="space-y-4">
            {needClassJustification && (
              <div>
                <label className="label">Travel-class upgrade — <strong>{className(req.travelClassId)}</strong> is above your <strong>{className(req.entitledClassId) || 'entitlement'}</strong></label>
                <p className="text-xs text-[var(--ecs-muted)] mb-1">A cabin above your entitlement requires a justification; the upgrade then routes to an approver.</p>
                <textarea name="classJustification" defaultValue={req.classJustification ?? ''} rows={2} required className="field" placeholder="e.g. overnight red-eye ahead of a same-day event; medical reason…" />
              </div>
            )}
            {aboveCapHotels.map((e) => (
              <div key={e.id}>
                <label className="label">Accommodation above cap — <strong>{cityName(e.accommodation!.city)}</strong>: SGD {e.accommodation!.quotedNightly}/night exceeds the cap SGD {e.accommodation!.capNightly}/night{e.travellerId ? ` (${EcsIdentity.employee(e.travellerId)?.name})` : ''}</label>
                <p className="text-xs text-[var(--ecs-muted)] mb-1">A rate above the cap requires a justification; it then routes to an approver.</p>
                <textarea name={`hotelNote_${e.id}`} defaultValue={e.notes ?? ''} rows={2} required className="field" placeholder="e.g. conference venue hotel — cheaper options are 45+ min away…" />
              </div>
            ))}
            <button className="btn-primary">Save justifications &amp; re-run checks</button>
          </form>
        </Card>
      )}

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

        {/* Trip and Policy Exceptions side by side. The Trip card carries the details (incl. entitled
            class) and the full itinerary; the Policy Exceptions card lists the hotel-cap / travel-class
            exceptions. The justification is captured on the Estimates airfare form and edited on the
            Policy Review step, so it is NOT repeated on this submit page. §13.14 / §13.19 / §4.4. */}
        <div className="grid md:grid-cols-2 gap-5 items-start">
        <Card title="Trip">
          <dl className="grid md:grid-cols-2 gap-3">
            <KV label="Purpose">{EcsReference.travelPurpose(req.purposeId ?? '')?.name}</KV>
            <KV label="Destination">{EcsReference.city(req.destCity ?? '')?.name}, {EcsReference.country(req.destCountry ?? '')?.name}</KV>
            <KV label="Dates">{fmtDate(req.startDate)} → {fmtDate(req.endDate)}</KV>
            {req.isGroup ? (
              <KV label="Travel class">Each traveller flies at their own class entitlement (§13.14) — per-traveller classes are shown in the cost items below.</KV>
            ) : (
              <>
                <KV label="Travel class">{proposedClassName}{classException && <span className="pill-warn ml-1">above entitlement</span>}</KV>
                <KV label="Entitled class">{entitledClassName ?? '—'}{policyGroupCode ? <span className="text-[var(--ecs-muted)]"> · {policyGroupCode}</span> : ''}</KV>
              </>
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
          {/* Itinerary — nested within the Trip card (the full route). */}
          <div className="mt-3 pt-3 border-t border-[var(--ecs-border)]">
            <div className="text-xs font-semibold text-[var(--ecs-muted)] mb-1">Itinerary</div>
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
          </div>
        </Card>
        {/* §13.19 Policy Exceptions — hotel-cap and travel-class exceptions only (the justification is
            not repeated here; it lives on the airfare form and the Policy Review step). */}
        <Card title="Policy Exceptions">
          {exceptions.length > 0 ? (
            <ul className="space-y-2">
              {exceptions.map((c) => (
                <li key={c.id} className="flex items-start gap-3 text-sm">
                  <OutcomePill outcome={c.outcome} />
                  <div>
                    <div className="font-medium">{c.label}{c.travellerId && <span className="text-[var(--ecs-muted)]"> · {EcsIdentity.employee(c.travellerId)?.name}</span>}</div>
                    <div className="text-xs text-[var(--ecs-muted)]">{c.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--ecs-muted)]">Within policy — no exceptions.</p>
          )}
          {hardStops.length > 0 && <p className="text-xs text-[var(--ecs-red)] mt-3 pt-3 border-t border-[var(--ecs-border)]">{hardStops.length} hard stop(s) block submission — resolve on the Policy Review step.</p>}
        </Card>
        </div>

        <CostItems req={req} summary={summary} basis={settings.approvalAmountBasis} />

        {/* Charging — beneath the cost items, in the full ECS Cost Allocation format. */}
        <CostAllocationCard req={req} amount={summary.ntuFunded} />


        {hasPersonal && (
          <Card title="Personal Travel (§12)">
            <p className="text-sm text-[var(--ecs-muted)]">
              This trip includes a personal extension{req.personalStart ? ` (${fmtDate(req.personalStart)} → ${fmtDate(req.personalEnd)})` : ''}. Personal days are excluded from ODA and personal nights from the accommodation budget (§4.5). Estimated incremental personal cost borne by the traveller: <strong>{fmtSgd(personalCost)}</strong>{personalCost === 0 ? ' (no chargeable personal nights captured)' : ''}.
            </p>
          </Card>
        )}

        {/* §13.x / DD-23 The Emergency lane and the Non-term research attestation are declared on the
            Trip step and stored on the request. They are carried into submission here as hidden inputs
            so submitRequest still validates and persists them (the capture UI lives on the Trip step). */}
        <input type="hidden" name="emergency" value={req.isEmergency ? 'on' : ''} />
        <input type="hidden" name="emergencyAuthoriserId" value={req.emergencyAuthoriserId ?? ''} />
        <input type="hidden" name="emergencyJustification" value={req.emergencyJustification ?? ''} />
        <input type="hidden" name="emergencyOutOfWindowAck" value={req.emergencyOutsideWindow ? 'on' : ''} />
        <input type="hidden" name="nonTerm" value={req.nonTermDeclared ? 'on' : ''} />

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
              <Link href={`/requests/${id}/charging`} className="btn-secondary">← Back</Link>
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

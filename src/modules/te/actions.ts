'use server';
// TE claim server actions — Create-from-Travel-Request entry point (§12 Claim step).
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/shared/db';
import { currentPersonaId } from '@/shared/session';
import { loadRequest } from '@/modules/pretrip/queries';
import { getSettings } from '@/modules/pretrip/settings';
import { nextClaimNumber } from '@/modules/pretrip/numbering';
import { prepopulateClaim } from './prepopulate';
import { getContractSettings, prepopContract, getGuardSettings, evaluateFlow } from '@/modules/pretrip/integration';
import { resolveChargingRows } from '@/modules/pretrip/chargingRollup';
import { EcsReference, EcsIdentity, EcsDelegation } from '@/shared/ecs/services';
import { isNonEmployeeMember } from '@/modules/pretrip/traveller';
import { resolveClaimTraveller } from './claimRemit';
import { buildClaimRoute, buildExceptionClaimRoute, type ClaimLike } from './workflow';
import { consumeLegacyBooking, releaseLegacyBookingsForClaim, legacyBookingByPnr } from './pnrLedger';
import { readOdaBasisForm, readAccomBasisForm, readPeriodsForm, claimOdaTotal, claimAccomTotal, carveClaimable, effectivePeriods } from './basis';
import { CLAIM_STATUS, claimStatusForRole, EXPENSE_CATEGORY } from '@/shared/enums';

const claimYear = () => new Date().getFullYear();

const claimWfOpts = (s: Awaited<ReturnType<typeof getSettings>>) => ({
  exceptionApproverRequired: s.exceptionApproverRequired,
  roRequirement: s.roRequirement,
  sameRouteResearch: s.sameRouteResearch,
  teAutoGrantTolerancePct: s.teAutoGrantTolerancePct,
  teAutoGrantToleranceAbsSgd: s.teAutoGrantToleranceAbsSgd,
});
const asClaimLike = (claim: { claimantId: string; lessCorpCard: number; lessPersonal: number; chargingMainCode: string | null; lines: { expenseTypeId: string; actualSgd: number; sponsorSgd: number; receiptType: string; treatment?: string }[] }): ClaimLike => claim;

/** §13.8 Create a draft TE claim pre-populated from an approved Travel Request. */
export async function createClaimFromRequest(requestId: string) {
  const req = await loadRequest(requestId);
  if (!req) return;
  const persona = await currentPersonaId();
  // §GRP-7 (agreed rule 11 November 2026): only the traveller, or their delegate, may raise the claim
  // for that traveller's share, and a delegate-raised claim is recorded as the traveller's. Students
  // and guests make no claim (GRP-5). The group requestor cannot claim for others unless a delegate.
  const members = req.isGroup
    ? req.travellers.filter((t) => !isNonEmployeeMember(t)).map((t) => t.employeeId)
    : [req.travellerId];
  const { travellerId: claimantId, onBehalf } = resolveClaimTraveller(members, persona, EcsDelegation.canCreateTravelRequestFor(persona));
  if (!claimantId) {
    await prisma.auditEvent.create({ data: { requestId, actorId: persona, kind: 'TE_LINK', summary: `Claim not raised — ${EcsIdentity.employee(persona)?.name ?? persona} is not the traveller or their delegate for ${req.requestNumber} (GRP-7)` } });
    redirect(`/requests/${requestId}/details?claimBlocked=1`);
  }
  // §13.8 parameter filters (Integration Contract, TE_SYNC flow) — only pre-populate a
  // claim when the request satisfies the ECS claim-sync conditions (default: status ∈
  // {Approved, Closed} and a TA issued). Prototype relaxes the "return date passed" rule.
  const gate = evaluateFlow(req, 'TE_SYNC', await getGuardSettings());
  if (!gate.ok) {
    await prisma.auditEvent.create({ data: { requestId, actorId: claimantId, kind: 'INTEGRATION', summary: `Claim creation blocked by contract filter — ${gate.checks.filter((c) => !c.pass).map((c) => `${c.rule} (is ${c.actual})`).join('; ')}` } });
    return;
  }

  // Existing claims for this request + claimant: reuse an open (Draft) one instead of
  // creating a duplicate; net submitted ones from the remaining budget (AC17).
  const existingLinks = await prisma.travelExpenseLink.findMany({
    where: { requestId, travellerId: claimantId },
    include: { claim: { include: { lines: true } } },
  });
  const openClaim = existingLinks.map((l) => l.claim).find((c) => c && c.status === 'Draft');
  if (openClaim) redirect(`/claims/${openClaim.id}`);

  const priorByCat: Record<string, number> = {};
  for (const l of existingLinks) for (const line of l.claim?.lines ?? []) priorByCat[line.category] = (priorByCat[line.category] ?? 0) + line.approvedSgd;

  const settings = await getSettings();
  const prep = prepopulateClaim(req, claimantId, settings.airfareTreatment, prepopContract(await getContractSettings()), priorByCat);

  if (prep.lines.length === 0) {
    await prisma.auditEvent.create({ data: { requestId, actorId: claimantId, kind: 'TE_LINK', summary: `Claim not created — ${req.requestNumber} is already fully claimed` } });
    return;
  }

  // §17 carry the TR's charging across as the claim's initial charging snapshot.
  const mainAlloc = req.allocations.find((a) => a.isMain) ?? req.allocations[0];
  const chargingMode = req.allocations.length > 1 ? 'CLAIM' : 'MAIN';
  const chargingJson = JSON.stringify({
    rows: req.allocations.map((a) => ({ code: a.chargingCode, percent: a.percent, amount: a.amountSgd ?? 0, io: a.internalOrder ?? '', isMain: a.isMain })),
    lineMap: {},
  });

  const claim = await prisma.travelExpenseClaim.create({
    data: {
      claimNumber: await nextClaimNumber(claimYear()),
      requestId,
      claimantId,
      // §13.8 header pre-populated from the approved TR (dates editable; TRS flag off when a TMC booking exists).
      trsNotBooked: req.bookings.length === 0,
      travelStart: req.startDate,
      travelEnd: req.endDate,
      additionalApprover1: req.additionalApproverId,
      chargingMode, chargingMainCode: mainAlloc?.chargingCode ?? null, chargingJson,
      lines: {
        create: prep.lines.map((l) => ({
          category: l.category, expenseTypeId: l.expenseTypeId, treatment: l.treatment,
          approvedSgd: l.approvedSgd, bookedSgd: l.bookedSgd, actualSgd: l.actualSgd,
          transactionDate: req.startDate, currency: 'SGD', foreignAmount: l.approvedSgd,
          reason: EcsReference.travelPurpose(req.purposeId ?? '')?.name ?? req.description ?? null,
        })),
      },
    },
  });
  await prisma.travelExpenseLink.create({ data: { requestId, claimId: claim.id, travellerId: claimantId } });
  await prisma.auditEvent.create({ data: { requestId, actorId: persona, kind: 'TE_LINK', summary: `TE claim ${claim.claimNumber} created from ${req.requestNumber}${onBehalf ? ` on behalf of ${EcsIdentity.employee(claimantId)?.name ?? claimantId} by ${EcsIdentity.employee(persona)?.name ?? persona}` : ''}` } });
  redirect(`/claims/${claim.id}`);
}

/** Link a claim-side (exception) claim to an approved Travel Request and PRE-POPULATE it from that TR —
 *  the same wiring as createClaimFromRequest, but applied to an existing Draft claim: its claimant-entered
 *  lines are replaced by the TR's budget lines, the exception flags are cleared, and the claim becomes a
 *  normal TR claim. Only an unlinked (requestId null, not legacy) Draft/SentBack claim may be linked. */
export async function linkClaimToRequest(claimId: string, fd: FormData) {
  const requestId = str(fd, 'linkRequestId');
  if (!requestId) return;
  const claim = await prisma.travelExpenseClaim.findUnique({ where: { id: claimId } });
  if (!claim || claim.requestId || claim.legacyPnr) return;                       // only a claim-side claim
  if (claim.status !== CLAIM_STATUS.Draft && claim.status !== CLAIM_STATUS.SentBack) return;
  const req = await loadRequest(requestId);
  if (!req) return;
  // Same claim-sync contract gate as createClaimFromRequest (status ∈ {Approved, Closed} + TA issued).
  const gate = evaluateFlow(req, 'TE_SYNC', await getGuardSettings());
  if (!gate.ok) {
    await prisma.auditEvent.create({ data: { requestId, actorId: claim.claimantId, kind: 'INTEGRATION', summary: `Claim ${claim.claimNumber} link blocked by contract filter — ${gate.checks.filter((c) => !c.pass).map((c) => `${c.rule} (is ${c.actual})`).join('; ')}` } });
    return;
  }
  // The claimant must be the TR's traveller (or their delegate), as for a fresh claim.
  const members = req.isGroup ? req.travellers.filter((t) => !isNonEmployeeMember(t)).map((t) => t.employeeId) : [req.travellerId];
  const { travellerId: claimantId } = resolveClaimTraveller(members, claim.claimantId, EcsDelegation.canCreateTravelRequestFor(claim.claimantId));
  if (!claimantId) {
    await prisma.auditEvent.create({ data: { requestId, actorId: claim.claimantId, kind: 'TE_LINK', summary: `Claim ${claim.claimNumber} not linked — the claimant is not the traveller or their delegate for ${req.requestNumber}` } });
    return;
  }
  const settings = await getSettings();
  const prep = prepopulateClaim(req, claimantId, settings.airfareTreatment, prepopContract(await getContractSettings()));
  if (prep.lines.length === 0) {
    await prisma.auditEvent.create({ data: { requestId, actorId: claimantId, kind: 'TE_LINK', summary: `Claim ${claim.claimNumber} not linked — ${req.requestNumber} is already fully claimed` } });
    return;
  }
  const mainAlloc = req.allocations.find((a) => a.isMain) ?? req.allocations[0];
  const chargingMode = req.allocations.length > 1 ? 'CLAIM' : 'MAIN';
  const chargingJson = JSON.stringify({ rows: req.allocations.map((a) => ({ code: a.chargingCode, percent: a.percent, amount: a.amountSgd ?? 0, io: a.internalOrder ?? '', isMain: a.isMain })), lineMap: {} });
  // Replace the claimant-entered lines with the TR budget lines; drop the now-irrelevant exception data.
  await prisma.tEExpenseLine.deleteMany({ where: { claimId } });
  await prisma.travelExpenseClaim.update({ where: { id: claimId }, data: {
    requestId, noTrException: false, noTrReason: null, exBookingRef: null,
    trsNotBooked: req.bookings.length === 0,
    travelStart: req.startDate, travelEnd: req.endDate, additionalApprover1: req.additionalApproverId,
    chargingMode, chargingMainCode: mainAlloc?.chargingCode ?? null, chargingJson,
    lines: { create: prep.lines.map((l) => ({
      category: l.category, expenseTypeId: l.expenseTypeId, treatment: l.treatment,
      approvedSgd: l.approvedSgd, bookedSgd: l.bookedSgd, actualSgd: l.actualSgd,
      transactionDate: req.startDate, currency: 'SGD', foreignAmount: l.approvedSgd,
      reason: EcsReference.travelPurpose(req.purposeId ?? '')?.name ?? req.description ?? null,
    })) },
  } });
  await prisma.travelExpenseLink.create({ data: { requestId, claimId, travellerId: claimantId } });
  await prisma.auditEvent.create({ data: { requestId, actorId: claim.claimantId, kind: 'TE_LINK', summary: `Claim ${claim.claimNumber} linked to ${req.requestNumber} — pre-populated from the approved Travel Request (no longer an exception claim)` } });
  redirect(`/claims/${claimId}`);
}

/** Claimant edits actual amounts; recompute variance (TR-17). */
export async function updateClaimActuals(claimId: string, fd: FormData) {
  const claim = await prisma.travelExpenseClaim.findUnique({ where: { id: claimId }, include: { lines: true } });
  if (!claim) return;
  for (const line of claim.lines) {
    const raw = fd.get(`actual_${line.id}`);
    if (raw === null) continue;
    const actual = parseFloat(String(raw)) || 0;
    await prisma.tEExpenseLine.update({ where: { id: line.id }, data: { actualSgd: actual, varianceSgd: actual - line.approvedSgd, receiptOk: fd.get(`receipt_${line.id}`) === 'on' } });
  }
  await prisma.auditEvent.create({ data: { requestId: claim.requestId, actorId: claim.claimantId, kind: 'AMEND', summary: `Actuals updated on claim ${claim.claimNumber}` } });
  revalidatePath(`/claims/${claimId}`);
}

/** §51 Submit the claim → build the configurable claim route (Verifier → [Exception] →
 *  [RO] → DOA), auto-granting the DOA from the approved Travel Request when in tolerance. */
export async function submitClaim(claimId: string) {
  const claim = await prisma.travelExpenseClaim.findUnique({ where: { id: claimId }, include: { lines: true } });
  if (!claim || (claim.status !== CLAIM_STATUS.Draft && claim.status !== CLAIM_STATUS.SentBack)) return;

  let steps;
  if (claim.noTrException) {
    // Exception claim (no Pre-Trip TR) — a reason for the missing TR is MANDATORY; then route for full
    // approval with no auto-grant (there is no approved request to inherit a DOA from).
    if (!claim.noTrReason || !claim.noTrReason.trim()) {
      await prisma.auditEvent.create({ data: { requestId: null, actorId: claim.claimantId, kind: 'STATUS', summary: `Claim ${claim.claimNumber} submission blocked — a reason for the missing Travel Request is required (exception claim)` } });
      revalidatePath(`/claims/${claimId}`);
      return;
    }
    // The offline approval email is MANDATORY on an exception claim — it is the only evidence the trip was
    // approved at all (there was no pre-trip Travel Request). Block submission until one is attached.
    const evidenceCount = await prisma.attachment.count({ where: { claimId, docType: 'OFFLINE_APPROVAL_EVIDENCE' } });
    if (evidenceCount === 0) {
      await prisma.auditEvent.create({ data: { requestId: null, actorId: claim.claimantId, kind: 'STATUS', summary: `Claim ${claim.claimNumber} submission blocked — the offline approval email must be attached (exception claim)` } });
      revalidatePath(`/claims/${claimId}`);
      return;
    }
    if (claim.lines.length === 0) { revalidatePath(`/claims/${claimId}`); return; }
    steps = buildExceptionClaimRoute(asClaimLike(claim));
  } else {
    if (!claim.requestId) return;
    const req = await loadRequest(claim.requestId);
    if (!req) return;
    // §8 Offline-approval evidence gate (te.evidence): block submission until every booking deviation that
    // requires evidence has a linked evidence attachment OR an approved waiver. Self-booked trips have no
    // TMC booking, hence no deviations, so this passes vacuously.
    // §GRP-7 a deviation gates only the claim of the traveller it belongs to (travellerId), plus any
    // request-wide (group-aggregate / non-group) deviation with no traveller attribution.
    const forClaimant = (d: { travellerId: string | null }) => d.travellerId == null || d.travellerId === claim.claimantId;
    const evidenceComplete = req.deviations.filter((d) => d.requiresEvidence && forClaimant(d)).every((d) => !!d.evidenceAttachmentId || !!d.waivedBy);
    const subGate = evaluateFlow({ status: req.status, bookingStatus: req.bookingStatus, bookingMethod: req.bookingMethod, authorisationNo: req.authorisationNo, evidenceComplete }, 'TE_SUBMIT', await getGuardSettings());
    if (!subGate.ok) {
      const pending = req.deviations.filter((d) => d.requiresEvidence && forClaimant(d) && !d.evidenceAttachmentId && !d.waivedBy);
      await prisma.auditEvent.create({ data: { requestId: req.id, actorId: claim.claimantId, kind: 'STATUS', summary: `Claim ${claim.claimNumber} submission blocked — ${pending.length} booking deviation(s) need offline-approval evidence or an approved waiver (§8): ${pending.map((d) => d.scopeRef ?? d.field).join(', ')}` } });
      revalidatePath(`/claims/${claimId}`);
      return;
    }
    // §7.3 (b) A pre-trip personal declaration can fall outside the ACTUAL travel when the trip moved after
    // the plan. When the TMC feed is present, every claim personal period must lie within the actual travel
    // window (earliest booked arrival → latest booked departure); otherwise the claimant must correct it.
    const actualDates = req.bookings.flatMap((b) => b.segments ?? []).filter((s) => s.type === 'AIR').flatMap((s) => [s.arriveDate, s.departDate]).filter((x): x is Date => !!x);
    if (actualDates.length) {
      const actualFrom = new Date(Math.min(...actualDates.map((x) => x.getTime())));
      const actualTo = new Date(Math.max(...actualDates.map((x) => x.getTime())));
      const toDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
      const outside = effectivePeriods(claim.claimPersonalPeriodsJson, req.personalPeriodsJson).filter((p) => toDate(p.start) < actualFrom || toDate(p.end) > actualTo);
      if (outside.length) {
        const fmt = (x: Date) => x.toISOString().slice(0, 10);
        await prisma.auditEvent.create({ data: { requestId: req.id, actorId: claim.claimantId, kind: 'STATUS', summary: `Claim ${claim.claimNumber} submission blocked — ${outside.length} personal period(s) fall outside the actual booked travel (${fmt(actualFrom)} → ${fmt(actualTo)}): ${outside.map((p) => `${p.start}→${p.end}`).join(', ')}. Update the personal days on the funded basis to match the booked travel.` } });
        revalidatePath(`/claims/${claimId}`);
        return;
      }
    }
    steps = buildClaimRoute(asClaimLike(claim), req, claimWfOpts(await getSettings()));
  }

  await prisma.claimApprovalStep.deleteMany({ where: { claimId } });
  for (const s of steps) {
    await prisma.claimApprovalStep.create({
      data: { claimId, seq: s.seq, roleType: s.roleType, approverId: s.approverId, autoGranted: !!s.autoGranted, status: s.autoGranted ? 'Approved' : 'Pending', decidedAt: s.autoGranted ? new Date() : null, comments: s.autoGranted ? s.note : null },
    });
  }
  const firstPending = steps.find((s) => !s.autoGranted);
  const status = firstPending ? claimStatusForRole(firstPending.roleType) : CLAIM_STATUS.Approved;
  await prisma.travelExpenseClaim.update({ where: { id: claimId }, data: { status } });
  const autoDoa = steps.find((s) => s.autoGranted);
  await prisma.auditEvent.create({ data: { requestId: claim.requestId, actorId: claim.claimantId, kind: 'STATUS', summary: `Claim ${claim.claimNumber} submitted — routed ${steps.map((s) => s.roleType).join(' → ')}${autoDoa ? ' (DOA auto-granted from the approved Travel Request)' : ''}${claim.noTrException ? ' · exception claim (no pre-trip approval)' : ''}` } });
  revalidatePath(`/claims/${claimId}`);
}

/** §8 The claim approver waives the offline-approval evidence requirement for a booking deviation, with
 *  a MANDATORY reason (recorded on the deviation and audited). A waiver without a reason is rejected. */
export async function waiveEvidence(deviationId: string, claimId: string, fd: FormData) {
  const persona = await currentPersonaId();
  const reason = String(fd.get('reason') ?? '').trim();
  const dev = await prisma.bookingDeviation.findUnique({ where: { id: deviationId } });
  if (!dev) return;
  if (!reason) {
    await prisma.auditEvent.create({ data: { requestId: dev.requestId, actorId: persona, kind: 'STATUS', summary: `Evidence waiver rejected — a reason is required (deviation "${dev.field}")` } });
    revalidatePath(`/claims/${claimId}`);
    return;
  }
  await prisma.bookingDeviation.update({ where: { id: deviationId }, data: { waivedBy: persona, waivedAt: new Date(), waiverReason: reason } });
  await prisma.auditEvent.create({ data: { requestId: dev.requestId, actorId: persona, kind: 'STATUS', summary: `Offline-approval evidence WAIVED for deviation "${dev.field}" by ${EcsIdentity.employee(persona)?.name ?? persona}: ${reason}` } });
  revalidatePath(`/claims/${claimId}`);
}

/** §51 An approver approves the current pending claim step. */
export async function approveClaimStep(claimId: string) {
  const persona = await currentPersonaId();
  const claim = await prisma.travelExpenseClaim.findUnique({ where: { id: claimId }, include: { approvalSteps: { orderBy: { seq: 'asc' } } } });
  if (!claim) return;
  const step = claim.approvalSteps.find((s) => s.status === 'Pending');
  if (!step) return;
  const isAdmin = EcsIdentity.hasRole(persona, 'TRAVEL_ADMIN') || EcsIdentity.hasRole(persona, 'SYSTEM_ADMIN');
  if (step.approverId !== persona && !isAdmin) return;
  const won = await prisma.claimApprovalStep.updateMany({ where: { id: step.id, status: 'Pending' }, data: { status: 'Approved', decidedAt: new Date() } });
  if (won.count === 0) return;
  await prisma.auditEvent.create({ data: { requestId: claim.requestId, actorId: persona, kind: 'APPROVE', summary: `Claim ${claim.claimNumber} — ${step.roleType} approved by ${EcsIdentity.employee(persona)?.name ?? persona}` } });
  const next = claim.approvalSteps.find((s) => s.seq > step.seq && s.status === 'Pending');
  const status = next ? claimStatusForRole(next.roleType) : CLAIM_STATUS.Approved;
  await prisma.travelExpenseClaim.update({ where: { id: claimId }, data: { status } });
  if (!next) await prisma.auditEvent.create({ data: { requestId: claim.requestId, actorId: persona, kind: 'STATUS', summary: `Claim ${claim.claimNumber} approved` } });
  revalidatePath(`/claims/${claimId}`);
}

/** §51 Send the claim back to the claimant (no reject — mirrors the TR). */
export async function sendBackClaim(claimId: string, fd: FormData) {
  const persona = await currentPersonaId();
  const claim = await prisma.travelExpenseClaim.findUnique({ where: { id: claimId }, include: { approvalSteps: { orderBy: { seq: 'asc' } } } });
  if (!claim) return;
  const step = claim.approvalSteps.find((s) => s.status === 'Pending');
  const isAdmin = EcsIdentity.hasRole(persona, 'TRAVEL_ADMIN') || EcsIdentity.hasRole(persona, 'SYSTEM_ADMIN');
  if (step && step.approverId !== persona && !isAdmin) return;
  if (step) await prisma.claimApprovalStep.update({ where: { id: step.id }, data: { status: 'SentBack', decidedAt: new Date(), comments: str(fd, 'comment') } });
  await prisma.travelExpenseClaim.update({ where: { id: claimId }, data: { status: CLAIM_STATUS.SentBack } });
  await prisma.auditEvent.create({ data: { requestId: claim.requestId, actorId: persona, kind: 'SENDBACK', summary: `Claim ${claim.claimNumber} sent back by ${EcsIdentity.employee(persona)?.name ?? persona}: ${str(fd, 'comment') || 'no reason given'}` } });
  revalidatePath(`/claims/${claimId}`);
}

/* ---------------------------------------- ECS Create-TE form editing (§13.8 / §17) */
const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === 'string' ? v : ''; };
const num = (fd: FormData, k: string) => { const v = parseFloat(str(fd, k)); return Number.isFinite(v) ? v : 0; };

/** Save the TE header + per-line actuals/reason/receipt (ECS Create-TE main form). */
export async function updateClaimHeader(claimId: string, fd: FormData) {
  const claim = await prisma.travelExpenseClaim.findUnique({ where: { id: claimId }, include: { lines: true } });
  if (!claim || claim.status !== 'Draft') return;
  // Exception (no-TR) claims carry their own manual header fields (there is no TR to copy from).
  const exUpd = claim.noTrException ? {
    noTrReason: str(fd, 'noTrReason') || null,
    exPurpose: str(fd, 'exPurpose') || null,
    exDestination: str(fd, 'exDestination') || null,
    exTravelClass: str(fd, 'exTravelClass') || null,
    exDescription: str(fd, 'exDescription') || null,
    exBookingRef: str(fd, 'exBookingRef') || null,
  } : {};
  await prisma.travelExpenseClaim.update({ where: { id: claimId }, data: {
    trsNotBooked: fd.get('trsNotBooked') === 'on',
    travelStart: str(fd, 'travelStart') ? new Date(str(fd, 'travelStart')) : null,
    travelEnd: str(fd, 'travelEnd') ? new Date(str(fd, 'travelEnd')) : null,
    additionalApprover2: str(fd, 'additionalApprover2') || null,
    lessCorpCard: num(fd, 'lessCorpCard'),
    lessPersonal: num(fd, 'lessPersonal'),
    ...exUpd,
  } });
  for (const l of claim.lines) {
    if (fd.get(`actual_${l.id}`) === null) continue;
    const actual = num(fd, `actual_${l.id}`);
    await prisma.tEExpenseLine.update({ where: { id: l.id }, data: {
      actualSgd: actual, varianceSgd: Math.round((actual - l.approvedSgd) * 100) / 100,
      reason: str(fd, `reason_${l.id}`) || l.reason,
      receiptType: str(fd, `receipt_${l.id}`) || l.receiptType,
      receiptOk: fd.get(`receiptok_${l.id}`) === 'on',
      // §13.8 claim-time policy-violation justification (pre-approved TR exceptions are synced
      // Reference-only on the page and never post a form field, so this only captures new ones).
      policyJustification: fd.get(`polJust_${l.id}`) !== null ? (str(fd, `polJust_${l.id}`) || null) : l.policyJustification,
    } });
  }
  // Exception claim — the offline-approval email (mandatory). Real bytes stored in-row as an
  // OFFLINE_APPROVAL_EVIDENCE attachment owned by the CLAIM (no TR to hang it off). Saved alongside the
  // header; the submit guard requires at least one before the claim can be submitted.
  if (claim.noTrException) {
    const file = fd.get('offlineApprovalFile');
    if (file && typeof file === 'object' && 'arrayBuffer' in file && (file as File).size > 0) {
      const f = file as File;
      const bytes = Buffer.from(await f.arrayBuffer());
      await prisma.attachment.create({ data: { claimId, docType: 'OFFLINE_APPROVAL_EVIDENCE', fileName: f.name, sizeKb: Math.max(1, Math.round(f.size / 1024)), contentType: f.type, content: bytes, uploadedById: claim.claimantId } });
    }
  }
  await prisma.auditEvent.create({ data: { requestId: claim.requestId, actorId: claim.claimantId, kind: 'AMEND', summary: `Claim ${claim.claimNumber} details updated` } });
  revalidatePath(`/claims/${claimId}`);
}

/** §4.5 Save the claimant's edited ODA / accommodation funded basis. The edited per-city rows are stored
 *  on the claim and OVERRIDE the TR: the ODA and accommodation expense-line actuals are recomputed from
 *  the funded (personal-excluded) totals, and the header personal-day count derives from this basis. The
 *  TR values stay the approved reference. Draft / sent-back only. */
export async function saveClaimBasis(claimId: string, fd: FormData) {
  const claim = await prisma.travelExpenseClaim.findUnique({ where: { id: claimId }, include: { lines: true } });
  if (!claim || (claim.status !== CLAIM_STATUS.Draft && claim.status !== CLAIM_STATUS.SentBack)) return;
  // The Funded basis card posts the BOOKED stay windows (full footprint) + the declared personal periods.
  // Carve the personal periods out of each window → CLAIMABLE segments (auto-split), which are what we store.
  const bookedOda = readOdaBasisForm(fd);
  const bookedAccom = readAccomBasisForm(fd);
  const periods = readPeriodsForm(fd);
  const oda = bookedOda.flatMap((o) => carveClaimable(o.arrive, o.depart, periods, 'day').map((s) => ({ ...o, arrive: s.from, depart: s.to })));
  const accom = bookedAccom.flatMap((a) => carveClaimable(a.checkIn, a.checkOut, periods, 'night').map((s) => ({ ...a, checkIn: s.from, checkOut: s.to })));
  const odaTotal = claimOdaTotal(oda);
  const accomTotal = claimAccomTotal(accom);
  await prisma.travelExpenseClaim.update({ where: { id: claimId }, data: {
    odaBasisJson: bookedOda.length ? JSON.stringify(oda) : null,       // claimable segments ("[]" = whole stay personal)
    accomBasisJson: bookedAccom.length ? JSON.stringify(accom) : null,
    claimPersonalPeriodsJson: periods.length ? JSON.stringify(periods.map((p) => ({ start: p.start, end: p.end }))) : null,
  } });
  // Reflect the recomputed claimable totals on the ODA / accommodation expense lines (the claim actual).
  const setLine = async (category: string, amount: number) => {
    const line = claim.lines.find((l) => l.category === category);
    if (line) await prisma.tEExpenseLine.update({ where: { id: line.id }, data: { actualSgd: amount, varianceSgd: Math.round((amount - line.approvedSgd) * 100) / 100 } });
  };
  if (bookedOda.length) await setLine(EXPENSE_CATEGORY.ODA, odaTotal);
  if (bookedAccom.length) await setLine(EXPENSE_CATEGORY.Accommodation, accomTotal);
  await prisma.auditEvent.create({ data: { requestId: claim.requestId, actorId: claim.claimantId, kind: 'AMEND', summary: `Claim ${claim.claimNumber} claimable basis edited — ODA ${odaTotal}, accommodation ${accomTotal} (personal days carved out)` } });
  revalidatePath(`/claims/${claimId}`);
}

/** Remove a claim-owned attachment (e.g. replace the offline-approval email). Draft/sent-back only. */
export async function removeClaimAttachment(claimId: string, attId: string) {
  const claim = await prisma.travelExpenseClaim.findUnique({ where: { id: claimId } });
  if (!claim || (claim.status !== CLAIM_STATUS.Draft && claim.status !== CLAIM_STATUS.SentBack)) return;
  await prisma.attachment.deleteMany({ where: { id: attId, claimId } });
  revalidatePath(`/claims/${claimId}`);
}

/** §2 Persist (replace) a per-line RECEIPT upload — real bytes stored in-row, the future AI-OCR source.
 *  Carries claimId too so the claim-scoped download route (/claims/[id]/attachments/[attId]) serves it. */
async function storeLineReceipt(claimId: string, lineId: string, uploadedBy: string, fd: FormData) {
  const file = fd.get('receiptFile');
  if (!(file && typeof file === 'object' && 'arrayBuffer' in file && (file as File).size > 0)) return;
  const f = file as File;
  const bytes = Buffer.from(await f.arrayBuffer());
  await prisma.attachment.deleteMany({ where: { lineId, docType: 'RECEIPT' } }); // one receipt per line
  await prisma.attachment.create({ data: { claimId, lineId, docType: 'RECEIPT', fileName: f.name, sizeKb: Math.max(1, Math.round(f.size / 1024)), contentType: f.type, content: bytes, uploadedById: uploadedBy } });
}

/** Add an expense line (ECS "Add Expense" modal). */
export async function addClaimExpense(claimId: string, fd: FormData) {
  const claim = await prisma.travelExpenseClaim.findUnique({ where: { id: claimId } });
  if (!claim || claim.status !== 'Draft') return;
  const typeId = str(fd, 'expenseTypeId');
  const type = EcsReference.expenseType(typeId);
  if (!type) return;
  const amount = num(fd, 'amount');
  const newLine = await prisma.tEExpenseLine.create({ data: {
    claimId, category: type.category, expenseTypeId: typeId, treatment: 'EDITABLE', manualEntry: true,
    approvedSgd: 0, bookedSgd: null, actualSgd: amount, varianceSgd: amount,
    transactionDate: str(fd, 'transactionDate') ? new Date(str(fd, 'transactionDate')) : null,
    currency: str(fd, 'currency') || 'SGD', foreignAmount: num(fd, 'foreignAmount') || amount,
    sponsorSgd: num(fd, 'sponsorship'), reason: str(fd, 'reason') || null,
    receiptType: str(fd, 'receiptType') || 'LOCAL_GST',
  } });
  await storeLineReceipt(claimId, newLine.id, claim.claimantId, fd);
  await prisma.auditEvent.create({ data: { requestId: claim.requestId, actorId: claim.claimantId, kind: 'AMEND', summary: `Expense line added to claim ${claim.claimNumber}` } });
  revalidatePath(`/claims/${claimId}`);
}

/** Edit an existing claim expense line (ECS per-line Edit dialog). A TR budget line keeps its type and
 *  approved estimate — the claimant edits the actual, currency, receipt, reason and sponsorship. A
 *  manually-added line may additionally change its expense type. */
export async function updateClaimExpenseLine(claimId: string, lineId: string, fd: FormData) {
  const claim = await prisma.travelExpenseClaim.findUnique({ where: { id: claimId } });
  if (!claim || claim.status !== 'Draft') return;
  const line = await prisma.tEExpenseLine.findUnique({ where: { id: lineId } });
  if (!line || line.claimId !== claimId) return;
  // A CTA / Reference line is centrally billed (shown for comparison) — the claimant does not edit it.
  if (line.treatment === 'REFERENCE') return;
  // §4.5 editable CLAIMABLE basis — an accommodation / ODA line carries an editable per-segment table of
  // claimable stays (personal already carved out). The rows are stored AS-IS (overriding the TMC-feed seed)
  // and totalled directly (nights/days × rate, no personal re-subtraction — so a deliberately claimed
  // personal date still counts and is flagged on the claim). "[]" = the whole stay was personal.
  const basisData: { accomBasisJson?: string | null; odaBasisJson?: string | null } = {};
  let amount = num(fd, `amount`);
  if (fd.has('accomCount') && line.category === EXPENSE_CATEGORY.Accommodation) {
    const accom = readAccomBasisForm(fd);
    basisData.accomBasisJson = JSON.stringify(accom);
    amount = claimAccomTotal(accom);
  } else if (fd.has('odaCount') && line.category === EXPENSE_CATEGORY.ODA) {
    const oda = readOdaBasisForm(fd);
    basisData.odaBasisJson = JSON.stringify(oda);
    amount = claimOdaTotal(oda);
  }
  // Only a manually-added line may change its expense type (a TR budget line's type is fixed).
  const typeUpd = line.manualEntry
    ? (() => { const t = EcsReference.expenseType(str(fd, 'expenseTypeId')); return t ? { expenseTypeId: str(fd, 'expenseTypeId'), category: t.category } : {}; })()
    : {};
  if (Object.keys(basisData).length) await prisma.travelExpenseClaim.update({ where: { id: claimId }, data: basisData });
  await prisma.tEExpenseLine.update({ where: { id: lineId }, data: {
    actualSgd: amount, varianceSgd: Math.round((amount - line.approvedSgd) * 100) / 100,
    currency: str(fd, 'currency') || line.currency, foreignAmount: num(fd, 'foreignAmount') || amount,
    sponsorSgd: num(fd, 'sponsorship'),
    receiptType: str(fd, 'receiptType') || line.receiptType,
    reason: str(fd, 'reason') || null,
    transactionDate: str(fd, 'transactionDate') ? new Date(str(fd, 'transactionDate')) : line.transactionDate,
    ...typeUpd,
  } });
  await storeLineReceipt(claimId, lineId, claim.claimantId, fd);
  await prisma.auditEvent.create({ data: { requestId: claim.requestId, actorId: claim.claimantId, kind: 'AMEND', summary: `Expense line edited on claim ${claim.claimNumber}` } });
  revalidatePath(`/claims/${claimId}`);
}

export async function removeClaimExpense(claimId: string, lineId: string) {
  const claim = await prisma.travelExpenseClaim.findUnique({ where: { id: claimId } });
  if (!claim || claim.status !== 'Draft') return;
  const line = await prisma.tEExpenseLine.findUnique({ where: { id: lineId } });
  if (!line || line.claimId !== claimId) return;
  // A budget line pre-populated from the approved TR cannot be deleted — only edited (set its actual to 0
  // if nothing was spent; the posting then excludes it). Only a manually-added claim line is deletable.
  if (!line.manualEntry) {
    await prisma.auditEvent.create({ data: { requestId: claim.requestId, actorId: claim.claimantId, kind: 'AMEND', summary: `Delete blocked — ${EcsReference.expenseType(line.expenseTypeId)?.name ?? line.category} is a budget line from the approved TR (set actual to 0 instead) on claim ${claim.claimNumber}` } });
    revalidatePath(`/claims/${claimId}`);
    return;
  }
  await prisma.tEExpenseLine.delete({ where: { id: lineId } });
  revalidatePath(`/claims/${claimId}`);
}

/** Save the claim's ECS charging (reuses the shared cascade form parser). */
export async function saveClaimCharging(claimId: string, fd: FormData) {
  const claim = await prisma.travelExpenseClaim.findUnique({ where: { id: claimId }, include: { lines: true } });
  if (!claim || claim.status !== 'Draft') return;
  const net = (l: { actualSgd: number; sponsorSgd: number }) => Math.max(l.actualSgd - l.sponsorSgd, 0);
  const total = Math.max(claim.lines.reduce((s, l) => s + net(l), 0) - claim.lessCorpCard - claim.lessPersonal, 0);
  const defaultCode = EcsIdentity.employee(claim.claimantId)?.defaultChargingCode ?? '';
  const expenses = claim.lines.map((l) => ({ id: l.id, sgdAmount: l.actualSgd, sponsorSgd: l.sponsorSgd }));
  const res = resolveChargingRows(fd, expenses, total, defaultCode);
  if (res.mode === 'ITEM') {
    for (const l of claim.lines) {
      const allocs = res.lineAllocs[l.id] ?? [];
      await prisma.tEExpenseLine.update({ where: { id: l.id }, data: { chargingCode: res.lineMap[l.id] || null, allocJson: allocs.length > 1 ? JSON.stringify(allocs) : null } });
    }
  } else {
    await prisma.tEExpenseLine.updateMany({ where: { claimId }, data: { chargingCode: null, allocJson: null } });
  }
  const mainCode = res.rows.find((r) => r.isMain)?.chargingCode ?? res.rows[0]?.chargingCode ?? null;
  const chargingJson = JSON.stringify({ rows: res.rows.map((r) => ({ code: r.chargingCode, percent: r.percent, amount: r.amountSgd ?? 0, io: r.internalOrder ?? '', isMain: r.isMain })), lineMap: res.lineMap });
  await prisma.travelExpenseClaim.update({ where: { id: claimId }, data: { chargingMode: res.mode, chargingMainCode: mainCode, chargingJson } });
  await prisma.auditEvent.create({ data: { requestId: claim.requestId, actorId: claim.claimantId, kind: 'AMEND', summary: `Charging allocation updated on claim ${claim.claimNumber}` } });
  revalidatePath(`/claims/${claimId}`);
  // Land on a fresh render of the claim so the per-line account selects re-hydrate cleanly from
  // the saved split (an in-place revalidate can leave native <select>s showing a stale display).
  redirect(`/claims/${claimId}`);
}

/** TMC transition — create a DRAFT claim against a pre-go-live LEGACY PNR (no Pre-Trip TR). The PNR is
 *  marked consumed in the unified ledger so it cannot be claimed twice (released on delete). */
export async function createClaimFromLegacyPnr(pnr: string) {
  const persona = await currentPersonaId();
  const booking = await legacyBookingByPnr(pnr);
  if (!booking) redirect('/claims/transition?error=notfound');
  if (booking.consumedByClaimId) redirect('/claims/transition?error=consumed');
  const claim = await prisma.travelExpenseClaim.create({
    data: {
      claimNumber: await nextClaimNumber(claimYear()),
      requestId: null, legacyPnr: pnr, claimantId: persona, trsNotBooked: false,
    },
  });
  const ok = await consumeLegacyBooking(pnr, claim.id);
  if (!ok) { await prisma.travelExpenseClaim.delete({ where: { id: claim.id } }); redirect('/claims/transition?error=consumed'); }
  await prisma.auditEvent.create({ data: { requestId: null, actorId: persona, kind: 'TE_LINK', summary: `Legacy TE claim ${claim.claimNumber} created from legacy PNR ${pnr} (${booking.tmcSource}) — TMC transition` } });
  redirect(`/claims/${claim.id}`);
}

/** Create a Draft TE claim directly on the claim side with NO Pre-Trip Travel Request (exception). This
 *  can ONLY be triggered from the claim side. Everything is entered manually; the claim bypasses pre-trip
 *  approval, so it routes for full approval (no auto-grant) and must carry a reason for the missing TR. */
export async function createExceptionClaim() {
  const persona = await currentPersonaId();
  const emp = EcsIdentity.employee(persona);
  const claim = await prisma.travelExpenseClaim.create({ data: {
    claimNumber: await nextClaimNumber(claimYear()),
    requestId: null, noTrException: true, claimantId: persona,
    trsNotBooked: true, // a manual exception claim has no NTU-TRS booking by default
    chargingMode: 'MAIN', chargingMainCode: emp?.defaultChargingCode ?? null,
  } });
  await prisma.auditEvent.create({ data: { requestId: null, actorId: persona, kind: 'TE_LINK', summary: `Exception TE claim ${claim.claimNumber} created without a Travel Request by ${emp?.name ?? persona}` } });
  redirect(`/claims/${claim.id}`);
}

/** Delete a DRAFT claim and RELEASE any legacy PNR it consumed back into the picker (TMC transition). */
export async function deleteClaim(claimId: string) {
  const claim = await prisma.travelExpenseClaim.findUnique({ where: { id: claimId } });
  if (!claim || claim.status !== CLAIM_STATUS.Draft) return;
  await releaseLegacyBookingsForClaim(claimId);
  await prisma.claimApprovalStep.deleteMany({ where: { claimId } });
  await prisma.tEExpenseLine.deleteMany({ where: { claimId } });
  await prisma.travelExpenseLink.deleteMany({ where: { claimId } });
  await prisma.travelExpenseClaim.delete({ where: { id: claimId } });
  await prisma.auditEvent.create({ data: { requestId: claim.requestId, actorId: claim.claimantId, kind: 'STATUS', summary: `Claim ${claim.claimNumber} deleted${claim.legacyPnr ? ` — legacy PNR ${claim.legacyPnr} released to the picker` : ''}` } });
  redirect(claim.legacyPnr ? '/claims/transition' : '/claims');
}

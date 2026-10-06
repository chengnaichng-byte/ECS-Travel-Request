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
import { EcsReference, EcsIdentity } from '@/shared/ecs/services';
import { buildClaimRoute, type ClaimLike } from './workflow';
import { CLAIM_STATUS, claimStatusForRole } from '@/shared/enums';

const claimYear = () => new Date().getFullYear();

const claimWfOpts = (s: Awaited<ReturnType<typeof getSettings>>) => ({
  exceptionApproverRequired: s.exceptionApproverRequired,
  roRequirement: s.roRequirement,
  sameRouteResearch: s.sameRouteResearch,
  teAutoGrantTolerancePct: s.teAutoGrantTolerancePct,
  teAutoGrantToleranceAbsSgd: s.teAutoGrantToleranceAbsSgd,
});
const asClaimLike = (claim: { claimantId: string; lessCorpCard: number; lessPersonal: number; chargingMainCode: string | null; lines: { expenseTypeId: string; actualSgd: number; sponsorSgd: number; receiptType: string }[] }): ClaimLike => claim;

/** §13.8 Create a draft TE claim pre-populated from an approved Travel Request. */
export async function createClaimFromRequest(requestId: string) {
  const req = await loadRequest(requestId);
  if (!req) return;
  const claimantId = await currentPersonaId();
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
  await prisma.auditEvent.create({ data: { requestId, actorId: claimantId, kind: 'TE_LINK', summary: `TE claim ${claim.claimNumber} created from ${req.requestNumber}` } });
  redirect(`/claims/${claim.id}`);
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
  if (!claim || !claim.requestId || (claim.status !== CLAIM_STATUS.Draft && claim.status !== CLAIM_STATUS.SentBack)) return;
  const req = await loadRequest(claim.requestId);
  if (!req) return;
  const steps = buildClaimRoute(asClaimLike(claim), req, claimWfOpts(await getSettings()));

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
  await prisma.auditEvent.create({ data: { requestId: claim.requestId, actorId: claim.claimantId, kind: 'STATUS', summary: `Claim ${claim.claimNumber} submitted — routed ${steps.map((s) => s.roleType).join(' → ')}${autoDoa ? ` (DOA auto-granted from ${req.authorisationNo})` : ''}` } });
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
  await prisma.travelExpenseClaim.update({ where: { id: claimId }, data: {
    trsNotBooked: fd.get('trsNotBooked') === 'on',
    travelStart: str(fd, 'travelStart') ? new Date(str(fd, 'travelStart')) : null,
    travelEnd: str(fd, 'travelEnd') ? new Date(str(fd, 'travelEnd')) : null,
    additionalApprover2: str(fd, 'additionalApprover2') || null,
    lessCorpCard: num(fd, 'lessCorpCard'),
    lessPersonal: num(fd, 'lessPersonal'),
  } });
  for (const l of claim.lines) {
    if (fd.get(`actual_${l.id}`) === null) continue;
    const actual = num(fd, `actual_${l.id}`);
    await prisma.tEExpenseLine.update({ where: { id: l.id }, data: {
      actualSgd: actual, varianceSgd: Math.round((actual - l.approvedSgd) * 100) / 100,
      reason: str(fd, `reason_${l.id}`) || l.reason,
      receiptType: str(fd, `receipt_${l.id}`) || l.receiptType,
      receiptOk: fd.get(`receiptok_${l.id}`) === 'on',
    } });
  }
  await prisma.auditEvent.create({ data: { requestId: claim.requestId, actorId: claim.claimantId, kind: 'AMEND', summary: `Claim ${claim.claimNumber} details updated` } });
  revalidatePath(`/claims/${claimId}`);
}

/** Add an expense line (ECS "Add Expense" modal). */
export async function addClaimExpense(claimId: string, fd: FormData) {
  const claim = await prisma.travelExpenseClaim.findUnique({ where: { id: claimId } });
  if (!claim || claim.status !== 'Draft') return;
  const typeId = str(fd, 'expenseTypeId');
  const type = EcsReference.expenseType(typeId);
  if (!type) return;
  const amount = num(fd, 'amount');
  await prisma.tEExpenseLine.create({ data: {
    claimId, category: type.category, expenseTypeId: typeId, treatment: 'EDITABLE',
    approvedSgd: 0, bookedSgd: null, actualSgd: amount, varianceSgd: amount,
    transactionDate: str(fd, 'transactionDate') ? new Date(str(fd, 'transactionDate')) : null,
    currency: str(fd, 'currency') || 'SGD', foreignAmount: amount,
    sponsorSgd: num(fd, 'sponsorship'), reason: str(fd, 'reason') || null,
    receiptType: str(fd, 'receiptType') || 'LOCAL_GST',
  } });
  await prisma.auditEvent.create({ data: { requestId: claim.requestId, actorId: claim.claimantId, kind: 'AMEND', summary: `Expense line added to claim ${claim.claimNumber}` } });
  revalidatePath(`/claims/${claimId}`);
}

export async function removeClaimExpense(claimId: string, lineId: string) {
  const claim = await prisma.travelExpenseClaim.findUnique({ where: { id: claimId } });
  if (!claim || claim.status !== 'Draft') return;
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
}

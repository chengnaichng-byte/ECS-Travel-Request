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

const claimYear = () => new Date().getFullYear();

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

  const claim = await prisma.travelExpenseClaim.create({
    data: {
      claimNumber: await nextClaimNumber(claimYear()),
      requestId,
      claimantId,
      lines: {
        create: prep.lines.map((l) => ({
          category: l.category, expenseTypeId: l.expenseTypeId, treatment: l.treatment,
          approvedSgd: l.approvedSgd, bookedSgd: l.bookedSgd, actualSgd: l.actualSgd,
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

export async function submitClaim(claimId: string) {
  const claim = await prisma.travelExpenseClaim.update({ where: { id: claimId }, data: { status: 'Submitted' } });
  await prisma.auditEvent.create({ data: { requestId: claim.requestId, actorId: claim.claimantId, kind: 'STATUS', summary: `Claim ${claim.claimNumber} submitted` } });
  revalidatePath(`/claims/${claimId}`);
}

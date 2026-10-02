// §6.4 / §13.14 material amendment. Adding or removing a traveller (or a share change
// above the amendment threshold) moves an approved request to "Amendment In Progress"
// and restarts approval from the first applicable step, re-deriving the route (the
// highest-charging-department DOA is recomputed). The Travel Authorisation Number is
// retained; a new approved version is created on reapproval (AC19). This is a plain
// module so both the server actions and the demo seed can call it.
import { prisma } from '@/shared/db';
import { loadRequest, type FullRequest } from './queries';
import { getSettings } from './settings';
import { computeSummary } from './pricing';
import { evaluatePolicies, hasException } from './policy';
import { buildRoute } from './route';
import { assembleOutboundInstructions } from './tmcPayload';
import { getContractSettings, tmcEnabledSet } from './integration';
import { CONTRACT_VERSION } from '@/config/integrationContracts';
import { EcsReference } from '@/shared/ecs/services';
import { REQUEST_STATUS, BOOKING_STATUS } from '@/shared/enums';
import { randomUUID } from 'node:crypto';

/** §33 Header field-diff of the amended request vs the last approved snapshot. */
function amendmentDiff(req: FullRequest): string[] {
  const prior = req.versions.find((v) => v.approved);
  if (!prior) return [];
  let h: Record<string, unknown> | undefined;
  try { h = JSON.parse(prior.snapshot).header; } catch { return []; }
  if (!h) return [];
  const iso = (d: unknown) => { if (!d) return '—'; const dt = new Date(d as string | number | Date); return isNaN(dt.getTime()) ? '—' : dt.toISOString().slice(0, 10); };
  const cls = (c: unknown) => EcsReference.travelClass(String(c ?? ''))?.name ?? '—';
  const city = (c: unknown) => EcsReference.city(String(c ?? ''))?.name ?? String(c ?? '—');
  const pur = (p: unknown) => EcsReference.travelPurpose(String(p ?? ''))?.name ?? '—';
  const pairs: [string, string, string][] = [
    ['Travel purpose', pur(h.purposeId), pur(req.purposeId)],
    ['Destination', city(h.destCity), city(req.destCity)],
    ['Start date', iso(h.startDate), iso(req.startDate)],
    ['End date', iso(h.endDate), iso(req.endDate)],
    ['Travel class', cls(h.travelClassId), cls(req.travelClassId)],
    ['Booking method', String(h.bookingMethod ?? '—'), String(req.bookingMethod ?? '—')],
  ];
  return pairs.filter(([, a, b]) => a !== b).map(([l, a, b]) => `${l}: ${a} → ${b}`);
}

/** Put a request into reapproval after a material change. Status becomes
 *  Amendment In Progress and stays there until the final reapproval. */
export async function applyMaterialAmendment(id: string, reason: string) {
  const req = await loadRequest(id);
  if (!req) return;
  const settings = await getSettings();

  // §13.18 material amendment may require the TMC booking to be suspended/updated.
  const bookingFlag = req.bookingStatus === BOOKING_STATUS.Booked || req.bookingStatus === BOOKING_STATUS.SentToTMC;

  // Re-evaluate policy and re-derive the approval route on the amended request.
  const checks = evaluatePolicies(req, settings.approvalAmountBasis);
  await prisma.policyCheck.deleteMany({ where: { requestId: id } });
  for (const c of checks) {
    await prisma.policyCheck.create({ data: { requestId: id, code: c.code, label: c.label, outcome: c.outcome, detail: c.detail, travellerId: c.travellerId ?? null } });
  }
  const summary = computeSummary(req.expenses, settings.approvalAmountBasis);
  await prisma.travelRequest.update({ where: { id }, data: { approvalAmountSgd: summary.approvalAmount, status: REQUEST_STATUS.AmendmentInProgress } });

  const fresh = (await loadRequest(id)) as FullRequest;
  const steps = buildRoute(fresh, {
    exceptionApproverRequired: settings.exceptionApproverRequired,
    sameRouteResearch: settings.sameRouteResearch,
    approvalAmount: summary.approvalAmount,
    hasException: hasException(checks),
    crossBaThresholdSgd: settings.crossBaThresholdSgd,
  });
  await prisma.approvalStep.deleteMany({ where: { requestId: id } });
  for (const s of steps) {
    await prisma.approvalStep.create({ data: { requestId: id, seq: s.seq, roleType: s.roleType, approverId: s.approverId, comments: s.note } });
  }

  // §33 field-diff of what changed vs the last approved snapshot.
  const diff = amendmentDiff(req);

  // New immutable version marking the amendment (§13.1 versioning rule).
  await prisma.travelRequestVersion.create({
    data: { requestId: id, version: req.currentVersion + 1, reason: 'AMENDMENT', approved: false, snapshot: JSON.stringify({ requestNumber: req.requestNumber, reason, changed: diff }) },
  });
  await prisma.travelRequest.update({ where: { id }, data: { currentVersion: req.currentVersion + 1 } });

  // §33 auto-retransmit — when a booking is already in flight/booked, send the TMC an
  // updated booking instruction reflecting the amendment (mock), and flag it.
  if (bookingFlag) {
    const meta = { messageId: randomUUID(), sentAt: new Date().toISOString(), sourceStatus: REQUEST_STATUS.AmendmentInProgress, contractVersion: CONTRACT_VERSION };
    const { mode, instructions } = assembleOutboundInstructions(fresh, tmcEnabledSet(await getContractSettings()), meta);
    const payloadObj = mode === 'GROUP_FANOUT'
      ? { meta, mode, kind: 'AMENDMENT_RETRANSMIT', authorisationNumber: fresh.authorisationNo ?? '', instructionCount: instructions.length, instructions }
      : { ...instructions[0], kind: 'AMENDMENT_RETRANSMIT' };
    await prisma.integrationMessage.create({ data: { requestId: id, direction: 'OUTBOUND', kind: 'TMC_AMEND', payload: JSON.stringify(payloadObj, null, 2) } });
  }

  const diffText = diff.length ? ` Changed: ${diff.join('; ')}.` : '';
  const bookingText = bookingFlag ? '; updated booking instruction retransmitted to the TMC (§33)' : '';
  await prisma.auditEvent.create({ data: { requestId: id, kind: 'AMEND', summary: `Material amendment — ${reason}.${diffText} Reapproval restarted (${steps.map((s) => s.roleType).join(' → ')})${bookingText}` } });
}

/** Statuses in which a traveller change is a free edit vs a material amendment. */
export function isFreeEditState(status: string): boolean {
  return status === REQUEST_STATUS.Draft || status === REQUEST_STATUS.SentBack;
}
export function isAmendableState(status: string): boolean {
  return (
    status.startsWith('Pending') ||
    status === REQUEST_STATUS.Approved ||
    status === REQUEST_STATUS.AmendmentInProgress
  );
}

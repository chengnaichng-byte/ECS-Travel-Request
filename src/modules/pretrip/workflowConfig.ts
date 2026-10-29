// §6.2 Workflow-scenario configuration service (DB-backed, ECS-structured). Seeds the TR_STANDARD
// scenario (approval tiers + decision points) idempotently from the default, reads it back for the
// viewer / simulator / editor, drives routing from the active stored scenario, and persists edits.
import { prisma } from '@/shared/db';
import { DOCUMENT_TYPE } from '@/shared/enums';
import { TR_STANDARD_SCENARIO, type WorkflowScenario } from '@/config/workflowScenario';

export async function ensureWorkflowScenarioSeed(): Promise<void> {
  if ((await prisma.workflowScenario.count()) > 0) return;
  const s = TR_STANDARD_SCENARIO;
  await prisma.workflowScenario.upsert({
    where: { code: s.code },
    update: {},
    create: { code: s.code, name: s.name, documentType: s.documentType, effectiveFrom: new Date(s.effectiveFrom), effectiveTo: new Date(s.effectiveTo), enabled: s.enabled, tiersJson: JSON.stringify(s.tiers), decisionPointsJson: JSON.stringify(s.decisionPoints) },
  });
}

export interface ScenarioListRow { id: string; code: string; name: string; documentType: string; effectiveFrom: Date; effectiveTo: Date; enabled: boolean; version: number }

export async function listScenarios(): Promise<ScenarioListRow[]> {
  await ensureWorkflowScenarioSeed();
  return prisma.workflowScenario.findMany({ orderBy: [{ documentType: 'asc' }, { name: 'asc' }] });
}

type Row = { code: string; name: string; documentType: string; effectiveFrom: Date; effectiveTo: Date; enabled: boolean; tiersJson: string; decisionPointsJson: string };
function toScenario(r: Row): WorkflowScenario {
  let tiers = []; let decisionPoints = [];
  try { tiers = JSON.parse(r.tiersJson); } catch { tiers = []; }
  try { decisionPoints = JSON.parse(r.decisionPointsJson); } catch { decisionPoints = []; }
  return { code: r.code, name: r.name, documentType: r.documentType, effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10), effectiveTo: r.effectiveTo.toISOString().slice(0, 10), enabled: r.enabled, tiers, decisionPoints };
}

export async function getScenario(code: string): Promise<WorkflowScenario | null> {
  await ensureWorkflowScenarioSeed();
  const r = await prisma.workflowScenario.findUnique({ where: { code } });
  return r ? toScenario(r) : null;
}

/** The active scenario that drives routing (Phase 3: the stored, editable scenario). Falls back to
 *  the default constant if the DB has none (so routing is never undefined). */
export async function getActiveWorkflowScenario(): Promise<WorkflowScenario> {
  // §6.2 the overarching scope is the DOCUMENT — the Pre-Trip module routes the TRAVEL_REQUEST scenario.
  const r = await prisma.workflowScenario.findFirst({ where: { documentType: DOCUMENT_TYPE.TravelRequest, enabled: true } });
  return r ? toScenario(r) : TR_STANDARD_SCENARIO;
}

// ---- Maintenance (runtime CRUD) --------------------------------------------------------------
export async function saveWorkflowScenario(s: WorkflowScenario): Promise<void> {
  await prisma.workflowScenario.upsert({
    where: { code: s.code },
    update: { name: s.name, documentType: s.documentType, effectiveFrom: new Date(s.effectiveFrom), effectiveTo: new Date(s.effectiveTo), enabled: s.enabled, tiersJson: JSON.stringify(s.tiers), decisionPointsJson: JSON.stringify(s.decisionPoints) },
    create: { code: s.code, name: s.name, documentType: s.documentType, effectiveFrom: new Date(s.effectiveFrom), effectiveTo: new Date(s.effectiveTo), enabled: s.enabled, tiersJson: JSON.stringify(s.tiers), decisionPointsJson: JSON.stringify(s.decisionPoints) },
  });
}

export async function setWorkflowScenarioEnabled(id: string, enabled: boolean): Promise<void> {
  await prisma.workflowScenario.update({ where: { id }, data: { enabled } });
}

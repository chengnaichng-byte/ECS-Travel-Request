// §6.2 Workflow-scenario configuration service (DB-backed, ECS-structured). Seeds the TR_STANDARD
// scenario idempotently from the default (src/config/workflowScenario.ts) and reads it back for the
// read-only viewer + simulator. Phase 1 keeps routing driven by the default constant (route.ts); a
// later phase switches buildRoute to read the active stored scenario and adds the editor.
import { prisma } from '@/shared/db';
import { TR_STANDARD_SCENARIO, type WorkflowScenario } from '@/config/workflowScenario';

/** Seed the default scenario once (idempotent). Safe to call on every read. */
export async function ensureWorkflowScenarioSeed(): Promise<void> {
  if ((await prisma.workflowScenario.count()) > 0) return;
  const s = TR_STANDARD_SCENARIO;
  await prisma.workflowScenario.upsert({
    where: { code: s.code },
    update: {},
    create: { code: s.code, name: s.name, effectiveFrom: new Date(s.effectiveFrom), effectiveTo: new Date(s.effectiveTo), enabled: s.enabled, tiersJson: JSON.stringify(s.tiers) },
  });
}

export interface ScenarioListRow { id: string; code: string; name: string; effectiveFrom: Date; effectiveTo: Date; enabled: boolean; version: number }

export async function listScenarios(): Promise<ScenarioListRow[]> {
  await ensureWorkflowScenarioSeed();
  return prisma.workflowScenario.findMany({ orderBy: { name: 'asc' } });
}

export async function getScenario(code: string): Promise<WorkflowScenario | null> {
  await ensureWorkflowScenarioSeed();
  const r = await prisma.workflowScenario.findUnique({ where: { code } });
  if (!r) return null;
  let tiers;
  try { tiers = JSON.parse(r.tiersJson); } catch { tiers = []; }
  return { code: r.code, name: r.name, effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10), effectiveTo: r.effectiveTo.toISOString().slice(0, 10), enabled: r.enabled, tiers };
}

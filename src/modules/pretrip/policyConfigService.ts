// §6.3 Policy-configuration service (DB-backed, ECS-structured). Seeds the default policies
// idempotently, reads them for the evaluator and the maintenance screens, and persists runtime edits
// (ECS "Edit Policy Rule" + Enable toggle + Copy to new version). The rules are stored as a JSON
// payload (PolicyRuleCfg[]); the evaluator (policyConfigEval.ts) runs them with the shared engine.
import { prisma } from '@/shared/db';
import { DOCUMENT_TYPE } from '@/shared/enums';
import { DEFAULT_POLICY_CONFIGS, type PolicyConfig, type PolicyRuleCfg } from '@/config/policyConfigs';

export async function ensurePolicyConfigSeed(): Promise<void> {
  if ((await prisma.policyConfig.count()) > 0) return;
  for (const p of DEFAULT_POLICY_CONFIGS) {
    await prisma.policyConfig.upsert({
      where: { code: p.code },
      update: {},
      create: { code: p.code, name: p.name, documentType: p.documentType, category: p.category, companyCode: p.companyCode, effectiveFrom: new Date(p.effectiveFrom), effectiveTo: new Date(p.effectiveTo), enabled: p.enabled, rulesJson: JSON.stringify(p.rules) },
    });
  }
}

type Row = { id: string; code: string; name: string; documentType: string; category: string; companyCode: string; effectiveFrom: Date; effectiveTo: Date; enabled: boolean; rulesJson: string; version: number };

function toConfig(r: Row): PolicyConfig {
  let rules: PolicyRuleCfg[] = [];
  try { rules = JSON.parse(r.rulesJson); } catch { rules = []; }
  return { code: r.code, name: r.name, documentType: r.documentType, category: r.category, companyCode: r.companyCode, effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10), effectiveTo: r.effectiveTo.toISOString().slice(0, 10), enabled: r.enabled, rules };
}

export interface PolicyListRow { id: string; code: string; name: string; documentType: string; category: string; companyCode: string; effectiveFrom: Date; effectiveTo: Date; enabled: boolean; version: number }

export async function listPolicyConfigs(): Promise<PolicyListRow[]> {
  await ensurePolicyConfigSeed();
  return prisma.policyConfig.findMany({ orderBy: [{ documentType: 'asc' }, { category: 'asc' }, { name: 'asc' }] });
}

export async function getPolicyConfig(code: string): Promise<PolicyConfig | null> {
  await ensurePolicyConfigSeed();
  const r = await prisma.policyConfig.findUnique({ where: { code } });
  return r ? toConfig(r) : null;
}

/** Active (enabled + effective-dated + document- & company-matched) policies for the evaluator.
 *  The DOCUMENT is the overarching scope — the Pre-Trip evaluator passes TRAVEL_REQUEST. */
export async function listActivePolicyConfigs(companyCode: string, documentType: string = DOCUMENT_TYPE.TravelRequest): Promise<PolicyConfig[]> {
  await ensurePolicyConfigSeed();
  const today = new Date();
  const rows = await prisma.policyConfig.findMany({ where: { enabled: true, documentType, companyCode, effectiveFrom: { lte: today }, effectiveTo: { gte: today } } });
  return rows.map(toConfig);
}

// ---- Maintenance (runtime CRUD) --------------------------------------------------------------
export async function savePolicyConfig(p: PolicyConfig): Promise<void> {
  await prisma.policyConfig.upsert({
    where: { code: p.code },
    update: { name: p.name, documentType: p.documentType, category: p.category, companyCode: p.companyCode, effectiveFrom: new Date(p.effectiveFrom), effectiveTo: new Date(p.effectiveTo), enabled: p.enabled, rulesJson: JSON.stringify(p.rules) },
    create: { code: p.code, name: p.name, documentType: p.documentType, category: p.category, companyCode: p.companyCode, effectiveFrom: new Date(p.effectiveFrom), effectiveTo: new Date(p.effectiveTo), enabled: p.enabled, rulesJson: JSON.stringify(p.rules) },
  });
}

export async function setPolicyConfigEnabled(id: string, enabled: boolean): Promise<void> {
  await prisma.policyConfig.update({ where: { id }, data: { enabled } });
}

export async function deletePolicyConfig(id: string): Promise<void> {
  await prisma.policyConfig.delete({ where: { id } });
}

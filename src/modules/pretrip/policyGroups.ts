// §13.19 Travel Policy Group master access. The group DEFINITIONS (duration tiers, entitled class)
// live in the reference master (data/travelPolicyGroups.ts); only the "attracts M6" flag is
// runtime-editable, stored in PolicyGroupM6 and seeded idempotently from the data-file default. This
// module merges the two so callers see the EFFECTIVE M6 flag, and exposes the maintenance setter.
import { prisma } from '@/shared/db';
import { travelPolicyGroups, type TravelPolicyGroup } from '@/data/travelPolicyGroups';

export type PolicyGroupRow = TravelPolicyGroup; // same shape; m6 is the DB-effective flag

export async function ensurePolicyGroupSeed(): Promise<void> {
  if ((await prisma.policyGroupM6.count()) === 0) {
    for (const g of travelPolicyGroups) {
      await prisma.policyGroupM6.upsert({ where: { code: g.code }, update: {}, create: { code: g.code, m6: g.m6 } });
    }
  }
}

/** All policy groups with the EFFECTIVE (DB-overridable) M6 flag merged onto the reference definition. */
export async function listPolicyGroups(): Promise<PolicyGroupRow[]> {
  await ensurePolicyGroupSeed();
  const flags = new Map((await prisma.policyGroupM6.findMany()).map((r) => [r.code, r.m6]));
  return travelPolicyGroups.map((g) => ({ ...g, m6: flags.get(g.code) ?? g.m6 }));
}

/** The set of policy-group codes that currently attract M6 (DB-effective). Passed to m6EconomyBaseSgd
 *  at capture time so the split reflects the live master, not the data-file default. */
export async function m6GroupCodes(): Promise<Set<string>> {
  await ensurePolicyGroupSeed();
  const rows = await prisma.policyGroupM6.findMany({ where: { m6: true } });
  return new Set(rows.map((r) => r.code));
}

/** Maintenance — toggle a group's M6 flag. */
export async function setPolicyGroupM6(code: string, m6: boolean): Promise<void> {
  await ensurePolicyGroupSeed();
  await prisma.policyGroupM6.upsert({ where: { code }, update: { m6 }, create: { code, m6 } });
}

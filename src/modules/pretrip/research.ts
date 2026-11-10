// §CHG-5 / RTE-9 / NTR-1 research classification (agreed rule, 11 November 2026).
// A travel request is "research" when the charging account carrying the LARGEST effective share of the
// request is a research account (isResearch on the shared charging master). On a tie for the largest
// share, the PRIMARY charging account (the isMain allocation) decides. Before any allocation exists
// (very early draft), the traveller's default charging account decides. The share is the effective
// split persisted on ChargingAllocation.percent, whatever the entry mode (MAIN / CLAIM / ITEM, CHG-2).
// This is a leaf module so routing (route.ts) and the non-term lane (nonTerm.ts) share one classifier.
import { EcsCharging, EcsIdentity } from '@/shared/ecs/services';

export interface ResearchAllocation { chargingCode: string; percent: number; isMain?: boolean }

const accountIsResearch = (chargingCode: string): boolean => !!EcsCharging.code(chargingCode)?.isResearch;

export function isResearchByCharging(allocations: ResearchAllocation[] | undefined, travellerId: string | null | undefined): boolean {
  const allocs = allocations ?? [];
  if (allocs.length) {
    const max = Math.max(...allocs.map((a) => a.percent || 0));
    const top = allocs.filter((a) => (a.percent || 0) === max);
    const decider = top.length === 1 ? top[0] : (top.find((a) => a.isMain) ?? allocs.find((a) => a.isMain) ?? top[0]);
    return accountIsResearch(decider.chargingCode);
  }
  const dc = travellerId ? EcsIdentity.employee(travellerId)?.defaultChargingCode : null;
  return dc ? accountIsResearch(dc) : false;
}

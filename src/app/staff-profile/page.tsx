// §4.1 Staff Profile — the first nav item. Two tabs: the existing ECS Staff Profile (an existing ECS
// screen, shown as a greyed, non-clickable label — not rebuilt in the prototype) and the Travel Policy
// tab (the traveller-facing policy reference, rendered here). The /policy route redirects here.
import { TravelPolicyView } from '@/components/TravelPolicyView';

export const dynamic = 'force-dynamic';

export default async function StaffProfilePage({ searchParams }: { searchParams: Promise<{ traveller?: string; dest?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="w-full space-y-5">
      {/* Tab bar — ECS Staff Profile (existing ECS screen, greyed off / not clickable) · Travel Policy (active) */}
      <div className="flex items-end gap-1 border-b border-[var(--ecs-border)]">
        <span className="px-4 py-2 text-sm font-medium text-slate-400 cursor-not-allowed select-none border-b-2 border-transparent -mb-px"
          title="Existing ECS screen — not rebuilt in the prototype">
          ECS Staff Profile
        </span>
        <span className="px-4 py-2 text-sm font-semibold text-[var(--ecs-navy)] border-b-2 border-[var(--ecs-red)] -mb-px">
          Travel Policy
        </span>
      </div>

      <TravelPolicyView traveller={sp.traveller} dest={sp.dest} />
    </div>
  );
}

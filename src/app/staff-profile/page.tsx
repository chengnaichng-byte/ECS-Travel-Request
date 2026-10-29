// §4.1 Staff Profile — the first nav item. Two tabs: the existing ECS Staff Profile (an existing ECS
// screen, linked out) and the Travel Policy tab (the traveller-facing policy reference, rendered here).
// The Travel Policy tab reuses TravelPolicyView; the /policy route redirects here.
import { TravelPolicyView } from '@/components/TravelPolicyView';

export const dynamic = 'force-dynamic';

// Existing ECS staff-profile screen (not rebuilt in the prototype) — opened in the ECS app.
export const ECS_STAFF_PROFILE_URL = 'https://apps.ntu.edu.sg/ECS/UserProfileSetting';

export default async function StaffProfilePage({ searchParams }: { searchParams: Promise<{ traveller?: string; dest?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="w-full space-y-5">
      {/* Tab bar — ECS Staff Profile (existing ECS screen, opens in ECS) · Travel Policy (active) */}
      <div className="flex items-end gap-1 border-b border-[var(--ecs-border)]">
        <a href={ECS_STAFF_PROFILE_URL} target="_blank" rel="noopener noreferrer"
          className="px-4 py-2 text-sm font-medium text-[var(--ecs-muted)] hover:text-[var(--ecs-navy)] border-b-2 border-transparent -mb-px">
          ECS Staff Profile <span aria-hidden className="text-xs">↗</span>
        </a>
        <span className="px-4 py-2 text-sm font-semibold text-[var(--ecs-navy)] border-b-2 border-[var(--ecs-red)] -mb-px">
          Travel Policy
        </span>
      </div>

      <TravelPolicyView traveller={sp.traveller} dest={sp.dest} />
    </div>
  );
}

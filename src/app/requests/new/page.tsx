// TR-02 Create Travel Request — Individual or Group (§13.14). §13.13 delegation: a
// Travel Requestor (e.g. PA) may create on behalf of travellers. ECS-derived profile
// data is shown at TR-03.
import { currentPersona } from '@/shared/session';
import { getSettings } from '@/modules/pretrip/settings';
import { EcsIdentity, EcsDelegation } from '@/shared/ecs/services';
import { employees } from '@/data/employees';
import { ROLE } from '@/shared/enums';
import { PageTitle } from '@/components/ui';
import { NewRequestForm } from '@/components/NewRequestForm';

export const dynamic = 'force-dynamic';

export default async function NewRequest({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const persona = await currentPersona();
  const settings = await getSettings();
  const { error } = await searchParams;
  const isRequestor = persona.roles.includes(ROLE.TravelRequestor);
  const delegators = EcsDelegation.canCreateTravelRequestFor(persona.id);

  const selectable = new Set<string>();
  if (persona.isTraveller) selectable.add(persona.id);
  delegators.forEach((d) => selectable.add(d));
  if (isRequestor) employees.filter((e) => e.isTraveller && e.departmentId === persona.departmentId).forEach((e) => selectable.add(e.id));
  if (selectable.size === 0) employees.filter((e) => e.isTraveller).forEach((e) => selectable.add(e.id));

  const toOpt = (e: (typeof employees)[number]) => ({ id: e.id, name: e.name, title: e.title, dept: EcsIdentity.department(e.departmentId)?.name ?? '', delegated: delegators.includes(e.id) });
  // Individual creation respects the requestor's remit; a group booking may name any employee
  // traveller (routing handles cross-department), so the group pool is the full traveller list.
  const options = (isRequestor ? employees.filter((e) => e.isTraveller) : employees.filter((e) => selectable.has(e.id))).map(toOpt);
  const groupOptions = employees.filter((e) => e.isTraveller).map(toOpt);

  return (
    <div className="max-w-2xl">
      <PageTitle id="TR-02" title="Create Travel Request"
        subtitle="Select the traveller (or travellers, for a group request). Traveller, entity, department, RO and Additional Approvers are derived from ECS/HR." />
      {error && <div className="card p-3 mb-4 text-sm text-red-800 bg-red-50 border-red-200">{error}</div>}
      <NewRequestForm
        persona={{ name: persona.name, title: persona.title }}
        isRequestor={isRequestor}
        options={options}
        groupOptions={groupOptions}
        groupMax={settings.groupMaxTravellers}
        groupEnabled={settings.groupTravelEnabled}
      />
    </div>
  );
}

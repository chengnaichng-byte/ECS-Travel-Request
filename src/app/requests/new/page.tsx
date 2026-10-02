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

export default async function NewRequest() {
  const persona = await currentPersona();
  const settings = await getSettings();
  const isRequestor = persona.roles.includes(ROLE.TravelRequestor);
  const delegators = EcsDelegation.canCreateTravelRequestFor(persona.id);

  const selectable = new Set<string>();
  if (persona.isTraveller) selectable.add(persona.id);
  delegators.forEach((d) => selectable.add(d));
  if (isRequestor) employees.filter((e) => e.isTraveller && e.departmentId === persona.departmentId).forEach((e) => selectable.add(e.id));
  if (selectable.size === 0) employees.filter((e) => e.isTraveller).forEach((e) => selectable.add(e.id));

  // Group mode may name travellers across the requestor's remit; offer all travellers.
  const groupPool = employees.filter((e) => e.isTraveller);
  const options = (isRequestor ? groupPool : employees.filter((e) => selectable.has(e.id))).map((e) => ({
    id: e.id, name: e.name, title: e.title,
    dept: EcsIdentity.department(e.departmentId)?.name ?? '',
    delegated: delegators.includes(e.id),
  }));

  return (
    <div className="max-w-2xl">
      <PageTitle id="TR-02" title="Create Travel Request"
        subtitle="Select the traveller (or travellers, for a group request). Traveller, entity, department, RO and Additional Approvers are derived from ECS/HR." />
      <NewRequestForm
        persona={{ name: persona.name, title: persona.title }}
        isRequestor={isRequestor}
        options={options}
        groupEnabled={settings.groupTravelEnabled}
      />
    </div>
  );
}

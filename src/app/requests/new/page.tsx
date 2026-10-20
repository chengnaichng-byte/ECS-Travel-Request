// TR-02 Create Travel Request — Individual or Group (§13.14). §13.13 delegation: a
// Travel Requestor (e.g. PA) may create on behalf of travellers. ECS-derived profile
// data is shown at TR-03.
import Link from 'next/link';
import { currentPersona } from '@/shared/session';
import { getSettings } from '@/modules/pretrip/settings';
import { EcsIdentity, EcsDelegation } from '@/shared/ecs/services';
import { employees } from '@/data/employees';
import { creatableTravellerIds } from '@/modules/pretrip/guards';
import { ROLE } from '@/shared/enums';
import { PageTitle, Card, Empty } from '@/components/ui';
import { NewRequestForm } from '@/components/NewRequestForm';

export const dynamic = 'force-dynamic';

export default async function NewRequest({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const persona = await currentPersona();
  const settings = await getSettings();
  const { error } = await searchParams;
  const isRequestor = persona.roles.includes(ROLE.TravelRequestor);
  const delegators = EcsDelegation.canCreateTravelRequestFor(persona.id);

  // Separation of duties (DD-24): a persona with no creation remit cannot raise a request.
  const selectable = creatableTravellerIds(persona.id);
  if (selectable.size === 0) {
    return (
      <div className="w-full max-w-2xl">
        <PageTitle id="TR-02" title="Create Travel Request" />
        <Card title="No authority to raise a travel request">
          <Empty>
            You are acting as <strong>{persona.name}</strong>, who does not hold a role that raises travel
            requests. Travel requests are originated by the traveller, a delegate/PA acting on their behalf,
            or the Travel Administrator — an approver-only role (e.g. a DOA) cannot raise a request it may
            later be asked to approve. Use the <Link href="/dashboard" className="underline">Travel Request Dashboard</Link> to monitor requests.
          </Empty>
        </Card>
      </div>
    );
  }

  const toOpt = (e: (typeof employees)[number]) => ({ id: e.id, name: e.name, title: e.title, dept: EcsIdentity.department(e.departmentId)?.name ?? '', email: e.email ?? '', delegated: delegators.includes(e.id) });
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
        guestMixAllowed={settings.groupGuestMixAllowed}
      />
    </div>
  );
}

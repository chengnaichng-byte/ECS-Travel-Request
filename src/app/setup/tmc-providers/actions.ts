'use server';
// §7.5 Multi-TMC provider maintenance (Setup & Maintenance). Admin-gated add / deactivate /
// reactivate / remove of the TMC providers a travel request can route to.
import { revalidatePath } from 'next/cache';
import { currentPersona } from '@/shared/session';
import { ROLE, BOOKING_METHOD } from '@/shared/enums';
import { addTmcProvider, setTmcProviderActive, deleteTmcProvider } from '@/modules/pretrip/tmcConfig';

async function isAdmin(): Promise<boolean> {
  const p = await currentPersona();
  return p.roles.includes(ROLE.TravelAdmin) || p.roles.includes(ROLE.SystemAdmin);
}
function revalidate() {
  revalidatePath('/setup/tmc-providers');
  revalidatePath('/config-viewer');
}

export async function createTmcProviderAction(fd: FormData) {
  if (!(await isAdmin())) return;
  const methods: string[] = [];
  for (const m of [BOOKING_METHOD.TMCOnline, BOOKING_METHOD.AgentAssisted, BOOKING_METHOD.Offline]) {
    if (fd.get(`m_${m}`) === 'on') methods.push(m);
  }
  await addTmcProvider({
    code: String(fd.get('code') ?? ''),
    name: String(fd.get('name') ?? ''),
    adapterKey: String(fd.get('adapterKey') ?? 'fcm'),
    scope: String(fd.get('scope') ?? 'ALL'),
    bookingMethods: methods,
    transport: String(fd.get('transport') ?? ''),
    pnrPrefix: String(fd.get('pnrPrefix') ?? ''),
    isDefault: fd.get('isDefault') === 'on',
    highRiskOnly: fd.get('highRiskOnly') === 'on',
  });
  revalidate();
}

export async function toggleTmcProviderAction(id: string, active: boolean) {
  if (!(await isAdmin())) return;
  await setTmcProviderActive(id, active);
  revalidate();
}

export async function deleteTmcProviderAction(id: string) {
  if (!(await isAdmin())) return;
  await deleteTmcProvider(id);
  revalidate();
}

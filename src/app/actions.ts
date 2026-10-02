'use server';
// Shell-level actions: persona switch (§4.1 role/context), Module Settings (TR-19),
// and the Integration Contract editor (TR-20).
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { PERSONA_COOKIE, ROLE_COOKIE, currentPersona } from '@/shared/session';
import { updateSettings } from '@/modules/pretrip/settings';
import { decisionCatalogue } from '@/config/decisions';
import { CONTRACT_FIELDS, CONTRACT_GUARDS, guardEditable } from '@/config/integrationContracts';
import { prisma } from '@/shared/db';
import { ROLE } from '@/shared/enums';

export async function setPersona(fd: FormData) {
  const id = String(fd.get('personaId') ?? 'E-TRAV');
  const role = String(fd.get('roleId') ?? '');
  const store = await cookies();
  store.set(PERSONA_COOKIE, id, { path: '/' });
  if (role) store.set(ROLE_COOKIE, role, { path: '/' });
  revalidatePath('/', 'layout');
}

/** TR-20 Save the admin Integration Contract — per field, what is sent to the TMC and
 * how it is treated when synced to the expense claim. Admin-gated (§8.3). */
export async function saveContractSettings(fd: FormData) {
  const persona = await currentPersona();
  const isAdmin = persona.roles.includes(ROLE.TravelAdmin) || persona.roles.includes(ROLE.SystemAdmin);
  if (!isAdmin) return;
  for (const f of CONTRACT_FIELDS) {
    if (f.tmc === 'core') continue; // core fields are always sent — not editable
    const includeTmc = f.tmc === 'toggle' ? fd.get(`tmc__${f.key}`) === 'on' : false;
    const teTreatment = f.te ? String(fd.get(`te__${f.key}`) ?? f.defaultTe ?? 'EXCLUDED') : (f.defaultTe ?? 'EXCLUDED');
    await prisma.integrationFieldSetting.upsert({
      where: { key: f.key },
      update: { includeTmc, teTreatment },
      create: { key: f.key, includeTmc, teTreatment },
    });
  }
  revalidatePath('/integration');
}

/** TR-20 Save the message parameter filters (guards) — when an outbound booking
 * instruction is sent / an inbound TMC response is accepted. Admin-gated. */
export async function saveContractGuards(fd: FormData) {
  const persona = await currentPersona();
  const isAdmin = persona.roles.includes(ROLE.TravelAdmin) || persona.roles.includes(ROLE.SystemAdmin);
  if (!isAdmin) return;
  for (const g of CONTRACT_GUARDS) {
    const enabled = fd.get(`guard_${g.key}`) === 'on';
    let value = '';
    if (guardEditable(g)) {
      value = g.op === 'in'
        ? JSON.stringify(fd.getAll(`guardval_${g.key}`).map(String))   // multi-select
        : String(fd.get(`guardval_${g.key}`) ?? (typeof g.value === 'string' ? g.value : ''));
    }
    await prisma.integrationGuardSetting.upsert({
      where: { key: g.key },
      update: { enabled, value },
      create: { key: g.key, enabled, value },
    });
  }
  revalidatePath('/integration');
}

export async function saveModuleSettings(fd: FormData) {
  const patch: Record<string, unknown> = {};
  for (const d of decisionCatalogue) {
    if (d.kind === 'boolean') patch[d.key] = fd.get(d.key) === 'on';
    else if (d.kind === 'number') patch[d.key] = parseInt(String(fd.get(d.key) ?? '0'), 10) || 0;
    else patch[d.key] = String(fd.get(d.key) ?? '');
  }
  patch.authorisationValidityDays = parseInt(String(fd.get('authorisationValidityDays') ?? '30'), 10) || 30;
  patch.bookingDeadlineDays = parseInt(String(fd.get('bookingDeadlineDays') ?? '14'), 10) || 14;
  // §43 settings breadth
  patch.selfApprovalLimitSgd = parseInt(String(fd.get('selfApprovalLimitSgd') ?? '0'), 10) || 0;
  patch.attachmentMaxMb = parseInt(String(fd.get('attachmentMaxMb') ?? '7'), 10) || 7;
  patch.chargingSplitMode = String(fd.get('chargingSplitMode') ?? 'PERCENT');
  patch.sftpConfig = String(fd.get('sftpConfig') ?? '');
  patch.declarationText = String(fd.get('declarationText') ?? '');
  patch.coiText = String(fd.get('coiText') ?? '');
  await updateSettings(patch);
  revalidatePath('/settings');
  revalidatePath('/', 'layout');
}

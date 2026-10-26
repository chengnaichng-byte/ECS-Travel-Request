'use server';
// DD-30 CTA master maintenance (Setup & Maintenance). Admin-gated add / edit / deactivate /
// reactivate of the Central Travel Account master (CTA → credit-GL clearing).
import { revalidatePath } from 'next/cache';
import { currentPersona } from '@/shared/session';
import { ROLE } from '@/shared/enums';
import { addCtaAccount, updateCtaAccount, setCtaActive, type CtaInput } from '@/modules/pretrip/ctaMaster';

async function isAdmin(): Promise<boolean> {
  const p = await currentPersona();
  return p.roles.includes(ROLE.TravelAdmin) || p.roles.includes(ROLE.SystemAdmin);
}

function fields(fd: FormData): CtaInput {
  return {
    label: String(fd.get('label') ?? '').trim(),
    provider: String(fd.get('provider') ?? '').trim(),
    companyCode: String(fd.get('companyCode') ?? '').trim(),
    currency: String(fd.get('currency') ?? '').trim(),
    clearingGlAccount: String(fd.get('clearingGlAccount') ?? '').trim(),
    effectiveFrom: String(fd.get('effectiveFrom') ?? '').trim(),
  };
}

export async function createCtaAction(fd: FormData) {
  if (!(await isAdmin())) return;
  await addCtaAccount(String(fd.get('ctaAccountId') ?? ''), fields(fd));
  revalidatePath('/setup/cta-accounts');
}

export async function updateCtaAction(id: string, fd: FormData) {
  if (!(await isAdmin())) return;
  await updateCtaAccount(id, fields(fd));
  revalidatePath('/setup/cta-accounts');
}

export async function toggleCtaAction(id: string, active: boolean) {
  if (!(await isAdmin())) return;
  await setCtaActive(id, active);
  revalidatePath('/setup/cta-accounts');
}

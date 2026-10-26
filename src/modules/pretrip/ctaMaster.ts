// DD-30 CTA master service. The Central Travel Account master (CTA → credit-GL clearing) is a
// maintainable reference master: list + add/edit/deactivate in Setup & Maintenance. It is
// DB-backed and seeded idempotently from src/data/ctaAccounts.ts so a fresh/reseeded database
// always carries the default accounts. The feed-reported ctaAccountId is the key; the posting
// programme and the CTA Charges view resolve the credit GL (clearing) account through here.
import { prisma } from '@/shared/db';
import { ctaAccounts as DEFAULT_CTA } from '@/data/ctaAccounts';

export interface CtaRow {
  id: string;
  ctaAccountId: string;
  label: string;
  provider: string;
  companyCode: string;
  currency: string;
  clearingGlAccount: string;
  active: boolean;
  effectiveFrom: string;
}

/** Seed the default CTA accounts once (idempotent). Safe to call on every read. */
export async function ensureCtaSeed(): Promise<void> {
  const n = await prisma.ctaAccount.count();
  if (n > 0) return;
  for (const a of DEFAULT_CTA) {
    await prisma.ctaAccount.upsert({
      where: { ctaAccountId: a.ctaAccountId },
      update: {},
      create: { ctaAccountId: a.ctaAccountId, label: a.label, provider: a.provider, companyCode: a.companyCode, currency: a.currency, clearingGlAccount: a.clearingGlAccount, active: a.active, effectiveFrom: a.effectiveFrom },
    });
  }
}

/** All CTA accounts (for the maintenance screen and the Configuration Viewer). */
export async function listCtaAccounts(): Promise<CtaRow[]> {
  await ensureCtaSeed();
  return prisma.ctaAccount.findMany({ orderBy: { ctaAccountId: 'asc' } });
}

/** Resolve one account by its feed key. Returns it regardless of active state, so a historical
 *  charge against a since-deactivated account still resolves its credit GL. */
export async function getCtaAccount(ctaAccountId: string | null | undefined): Promise<CtaRow | undefined> {
  if (!ctaAccountId) return undefined;
  await ensureCtaSeed();
  return (await prisma.ctaAccount.findUnique({ where: { ctaAccountId } })) ?? undefined;
}

/** Map of ctaAccountId → account, for resolving a batch of charges (the CTA Charges read model). */
export async function ctaAccountsMap(): Promise<Map<string, CtaRow>> {
  const all = await listCtaAccounts();
  return new Map(all.map((a) => [a.ctaAccountId, a]));
}

export interface CtaInput { label: string; provider: string; companyCode: string; currency: string; clearingGlAccount: string; effectiveFrom: string }

/** Add (or, if the feed key already exists, update & reactivate) a CTA account. */
export async function addCtaAccount(ctaAccountId: string, d: CtaInput): Promise<void> {
  if (!ctaAccountId.trim() || !d.clearingGlAccount.trim()) return;
  await prisma.ctaAccount.upsert({
    where: { ctaAccountId: ctaAccountId.trim() },
    update: { ...d, active: true },
    create: { ctaAccountId: ctaAccountId.trim(), ...d, active: true },
  });
}

/** Edit an existing account's attributes (the feed key is fixed — it identifies the card). */
export async function updateCtaAccount(id: string, d: CtaInput): Promise<void> {
  await prisma.ctaAccount.update({ where: { id }, data: d });
}

export async function setCtaActive(id: string, active: boolean): Promise<void> {
  await prisma.ctaAccount.update({ where: { id }, data: { active } });
}

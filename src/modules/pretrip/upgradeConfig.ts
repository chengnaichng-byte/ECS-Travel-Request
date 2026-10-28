// #14 Upgrade-routing configuration — runtime-editable masters that drive how an NTU-funded
// travel-class upgrade differential is derived (Model B uplift %) and where it charges (the M6
// account, selected per Business Area). Both are DB-backed and seeded idempotently so a fresh /
// reseeded database always has a sensible default schedule and at least one M6 account per BA.
import { prisma } from '@/shared/db';
import { travelClasses } from '@/data/travelClass';
import { businessAreas } from '@/data/charging';
import { EXPENSE_CATEGORY } from '@/shared/enums';
import { airfareUpgrade } from './upgrade';
import { getSettings } from './settings';

const r2 = (n: number) => Math.round(n * 100) / 100;

// ---- Uplift % schedule (Model B) -------------------------------------------------------------
// Default uplift OVER the entitlement for each upward class step, derived from the published
// class cost indices (Economy = 1.0): e.g. Economy→Business = 2.2/1.0 − 1 = 120%. Editable at runtime.
function defaultUpliftRates(): { fromClassId: string; toClassId: string; pct: number }[] {
  const out: { fromClassId: string; toClassId: string; pct: number }[] = [];
  for (const from of travelClasses) for (const to of travelClasses) {
    if (to.rank > from.rank && from.costIndex > 0) {
      out.push({ fromClassId: from.id, toClassId: to.id, pct: r2(to.costIndex / from.costIndex - 1) });
    }
  }
  return out;
}

// Default M6 accounts — one per Business Area (the BA's default), plus a second BA-CS account so the
// multi-account selection path is demonstrable. Editable at runtime.
function defaultUpgradeAccounts(): { code: string; name: string; businessArea: string; companyCode: string; isDefault: boolean }[] {
  const out: { code: string; name: string; businessArea: string; companyCode: string; isDefault: boolean }[] = [];
  for (const ba of businessAreas) {
    out.push({ code: `M6-${ba.code.replace(/^BA-/, '')}`, name: `${ba.name} — NTU-Funded Upgrade Differential`, businessArea: ba.code, companyCode: ba.companyCode, isDefault: true });
  }
  // a second BA-CS account (e.g. a school-specific differential pool) to exercise traveller selection
  out.push({ code: 'M6-CS-DEAN', name: 'SCSE Dean Office — Upgrade Differential', businessArea: 'BA-CS', companyCode: '1000', isDefault: false });
  return out;
}

export async function ensureUpgradeConfigSeed(): Promise<void> {
  if ((await prisma.upgradeUpliftRate.count()) === 0) {
    for (const r of defaultUpliftRates()) {
      await prisma.upgradeUpliftRate.upsert({
        where: { fromClassId_toClassId: { fromClassId: r.fromClassId, toClassId: r.toClassId } },
        update: {}, create: { ...r, active: true },
      });
    }
  }
  if ((await prisma.upgradeDeltaAccount.count()) === 0) {
    for (const a of defaultUpgradeAccounts()) {
      await prisma.upgradeDeltaAccount.upsert({ where: { code: a.code }, update: {}, create: { ...a, active: true } });
    }
  }
}

export interface UpliftRateRow { id: string; fromClassId: string; toClassId: string; pct: number; active: boolean }
export interface UpgradeAccountRow { id: string; code: string; name: string; companyCode: string; businessArea: string; active: boolean; isDefault: boolean }

export async function listUpliftRates(): Promise<UpliftRateRow[]> {
  await ensureUpgradeConfigSeed();
  return prisma.upgradeUpliftRate.findMany({ orderBy: [{ fromClassId: 'asc' }, { toClassId: 'asc' }] });
}

export async function listUpgradeAccounts(): Promise<UpgradeAccountRow[]> {
  await ensureUpgradeConfigSeed();
  return prisma.upgradeDeltaAccount.findMany({ orderBy: [{ businessArea: 'asc' }, { code: 'asc' }] });
}

/** The active uplift fraction for a class step (from → to); null when none is configured. */
export function upliftPctFrom(rates: UpliftRateRow[], fromClassId: string | null | undefined, toClassId: string | null | undefined): number | null {
  if (!fromClassId || !toClassId) return null;
  const r = rates.find((x) => x.active && x.fromClassId === fromClassId && x.toClassId === toClassId);
  return r ? r.pct : null;
}

/** Derived entitlement fare (Model B): chosenFare / (1 + pct). Null when the step has no rate. */
export function deriveEntitlementSgd(fareSgd: number, pct: number | null): number | null {
  if (pct == null || pct <= 0 || fareSgd <= 0) return null;
  return r2(fareSgd / (1 + pct));
}

/** Active M6 accounts available for a Business Area (the pool the traveller selects from). */
export function accountsForBA(accounts: UpgradeAccountRow[], ba: string | null | undefined): UpgradeAccountRow[] {
  if (!ba) return [];
  return accounts.filter((a) => a.active && a.businessArea === ba);
}

/** The default M6 account for a BA — the flagged default, else the only active one, else null. */
export function defaultAccountForBA(accounts: UpgradeAccountRow[], ba: string | null | undefined): UpgradeAccountRow | null {
  const pool = accountsForBA(accounts, ba);
  return pool.find((a) => a.isDefault) ?? (pool.length === 1 ? pool[0] : null);
}

/** The M6 account an NTU-funded delta should charge, given the current selection:
 *  keep a valid existing choice; auto-pick when the BA has one account (or selection isn't required);
 *  otherwise null to force the traveller to choose (the policy hard stop then fires). */
export function effectiveDeltaCode(accounts: UpgradeAccountRow[], ba: string | null | undefined, selectionRequired: boolean, currentCode: string | null | undefined): string | null {
  const pool = accountsForBA(accounts, ba);
  if (currentCode && pool.some((a) => a.code === currentCode)) return currentCode;
  if (pool.length === 1) return pool[0].code;
  if (!selectionRequired) return defaultAccountForBA(accounts, ba)?.code ?? pool[0]?.code ?? null;
  return null;
}

/** Auto-fill the M6 account on a request's NTU-funded upgrade airfare lines (and clear a stale one
 *  on lines that are no longer NTU-funded upgrades). Leaves null where a choice is still required so
 *  the policy hard stop surfaces. Called from saveCharging / setUpgradeDeltaAccount before policy. */
export async function applyDefaultDeltaCodes(requestId: string): Promise<void> {
  const settings = await getSettings();
  if (!settings.upgradeDeltaRoutingEnabled) return;
  const accounts = await listUpgradeAccounts();
  const req = await prisma.travelRequest.findUnique({ where: { id: requestId }, include: { allocations: true, expenses: true } });
  if (!req) return;
  const govBA = (req.allocations.find((a) => a.isMain) ?? req.allocations[0])?.businessArea ?? null;
  for (const e of req.expenses) {
    if (e.category !== EXPENSE_CATEGORY.Airfare) { continue; }
    const u = airfareUpgrade({ sgdAmount: e.sgdAmount, entitlementFareSgd: e.entitlementFareSgd, upgradeFunding: e.upgradeFunding, upgradeDeltaCode: e.upgradeDeltaCode });
    const next = (u.isUpgrade && u.funding === 'NTU')
      ? effectiveDeltaCode(accounts, govBA, settings.upgradeDeltaSelectionRequired, e.upgradeDeltaCode)
      : null;
    if (next !== (e.upgradeDeltaCode ?? null)) {
      await prisma.estimatedExpense.update({ where: { id: e.id }, data: { upgradeDeltaCode: next } });
    }
  }
}

// ---- Maintenance (runtime CRUD) --------------------------------------------------------------
export async function upsertUpliftRate(fromClassId: string, toClassId: string, pct: number): Promise<void> {
  if (!fromClassId || !toClassId || !(pct > 0)) return;
  await prisma.upgradeUpliftRate.upsert({
    where: { fromClassId_toClassId: { fromClassId, toClassId } },
    update: { pct: r2(pct), active: true }, create: { fromClassId, toClassId, pct: r2(pct), active: true },
  });
}

export async function setUpliftRateActive(id: string, active: boolean): Promise<void> {
  await prisma.upgradeUpliftRate.update({ where: { id }, data: { active } });
}

export async function addUpgradeAccount(code: string, name: string, businessArea: string, companyCode: string, isDefault: boolean): Promise<void> {
  if (!code || !name || !businessArea) return;
  await prisma.upgradeDeltaAccount.upsert({
    where: { code },
    update: { name, businessArea, companyCode: companyCode || '1000', active: true, isDefault },
    create: { code, name, businessArea, companyCode: companyCode || '1000', active: true, isDefault },
  });
  // a BA has one default at most — clear the flag on the others when this one is the default.
  if (isDefault) {
    await prisma.upgradeDeltaAccount.updateMany({ where: { businessArea, code: { not: code } }, data: { isDefault: false } });
  }
}

export async function setUpgradeAccountActive(id: string, active: boolean): Promise<void> {
  await prisma.upgradeDeltaAccount.update({ where: { id }, data: { active } });
}

export interface UpgradeAccountImportRow { code?: string; name?: string; businessArea?: string; companyCode?: string; active?: boolean; isDefault?: boolean }

/** Full-replace the M6 account master from an uploaded list (Excel). Validates, de-duplicates by code
 *  (last wins), enforces at most one default per BA, then atomically replaces every row. Returns the
 *  number of accounts written and any rows skipped for missing required fields. */
export async function replaceUpgradeAccounts(rows: UpgradeAccountImportRow[]): Promise<{ count: number; skipped: number }> {
  const seenDefault = new Set<string>();
  const byCode = new Map<string, { code: string; name: string; businessArea: string; companyCode: string; active: boolean; isDefault: boolean }>();
  let skipped = 0;
  for (const r of rows) {
    const code = String(r.code ?? '').trim();
    const name = String(r.name ?? '').trim();
    const businessArea = String(r.businessArea ?? '').trim();
    if (!code || !name || !businessArea) { skipped++; continue; }
    let isDefault = r.isDefault === true || String(r.isDefault).toLowerCase() === 'true' || String(r.isDefault).toLowerCase() === 'yes';
    if (isDefault) { if (seenDefault.has(businessArea)) isDefault = false; else seenDefault.add(businessArea); }
    const active = !(r.active === false || String(r.active).toLowerCase() === 'false' || String(r.active).toLowerCase() === 'no' || String(r.active).toLowerCase() === 'inactive');
    byCode.set(code, { code, name, businessArea, companyCode: String(r.companyCode ?? '1000').trim() || '1000', active, isDefault });
  }
  const data = [...byCode.values()];
  await prisma.$transaction([
    prisma.upgradeDeltaAccount.deleteMany({}),
    ...data.map((d) => prisma.upgradeDeltaAccount.create({ data: d })),
  ]);
  return { count: data.length, skipped };
}

// ---- Policy-engine context -------------------------------------------------------------------
// The policy engine (pure) can't read the DB, so persistPolicy / amend / demo fetch this and pass it.
export interface UpgradeCheckCtx {
  enabled: boolean;
  selectionRequired: boolean;
  accounts: { code: string; businessArea: string; active: boolean }[];
}

export async function upgradeCheckCtx(settings: { upgradeDeltaRoutingEnabled: boolean; upgradeDeltaSelectionRequired: boolean }): Promise<UpgradeCheckCtx> {
  const accounts = await listUpgradeAccounts();
  return {
    enabled: settings.upgradeDeltaRoutingEnabled,
    selectionRequired: settings.upgradeDeltaSelectionRequired,
    accounts: accounts.map((a) => ({ code: a.code, businessArea: a.businessArea, active: a.active })),
  };
}

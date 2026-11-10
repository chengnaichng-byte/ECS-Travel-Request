// §7.5 Multi-TMC provider master — the runtime-editable registry behind the TMC routing and the
// Trip booking-arrangement picker. Seeded once from the data-file default (src/data/tmcProviders.ts),
// then maintained in the DB (TmcProviderConfig) via the Setup & Maintenance screen. Returns the SAME
// TmcProvider shape the data file used, so routing / dropdown code is unchanged apart from awaiting it.
import { prisma } from '@/shared/db';
import { tmcProviders as seedProviders, type TmcProvider } from '@/data/tmcProviders';

const splitList = (s: string): string[] => s.split(',').map((x) => x.trim()).filter(Boolean);

type Row = Awaited<ReturnType<typeof prisma.tmcProviderConfig.findMany>>[number];
function toProvider(r: Row): TmcProvider {
  return {
    id: r.code,
    name: r.name,
    adapterKey: r.adapterKey,
    active: r.active,
    scope: r.scope === 'ALL' ? 'ALL' : splitList(r.scope),
    bookingMethods: splitList(r.bookingMethods),
    transport: r.transport,
    pnrPrefix: r.pnrPrefix,
    isDefault: r.isDefault || undefined,
    highRiskOnly: r.highRiskOnly || undefined,
  };
}

/** Seed the DB master from the data-file default on first use (idempotent — only when empty). */
export async function ensureTmcSeed(): Promise<void> {
  const n = await prisma.tmcProviderConfig.count();
  if (n > 0) return;
  await prisma.tmcProviderConfig.createMany({
    data: seedProviders.map((p, i) => ({
      code: p.id, name: p.name, adapterKey: p.adapterKey, active: p.active,
      scope: p.scope === 'ALL' ? 'ALL' : p.scope.join(','),
      bookingMethods: p.bookingMethods.join(','), transport: p.transport, pnrPrefix: p.pnrPrefix,
      isDefault: !!p.isDefault, highRiskOnly: !!p.highRiskOnly, sortOrder: i,
    })),
  });
}

/** The live, DB-effective provider list (seeded on first call). */
export async function listTmcProviders(): Promise<TmcProvider[]> {
  await ensureTmcSeed();
  const rows = await prisma.tmcProviderConfig.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
  return rows.map(toProvider);
}

/** Raw rows (for the maintenance screen — carry the DB id and sortOrder). */
export async function listTmcProviderRows() {
  await ensureTmcSeed();
  return prisma.tmcProviderConfig.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
}

export interface TmcProviderInput {
  code: string; name: string; adapterKey: string; scope: string; bookingMethods: string[];
  transport: string; pnrPrefix: string; isDefault: boolean; highRiskOnly: boolean;
}

export async function addTmcProvider(input: TmcProviderInput): Promise<void> {
  // The code is also the booking-arrangement key, which must start with "TMC-" to be treated as a
  // TMC arrangement (isTmcArrangement). Normalise so an admin can type just the short key.
  let code = input.code.trim();
  if (!/^TMC-/i.test(code)) code = 'TMC-' + code.replace(/^-+/, '');
  code = code.toUpperCase();
  if (!code || code === 'TMC-' || !input.name.trim()) return;
  const scope = input.scope.trim().toUpperCase() === 'ALL' || !input.scope.trim() ? 'ALL' : splitList(input.scope.toUpperCase()).join(',');
  const data = {
    name: input.name.trim(), adapterKey: input.adapterKey.trim() || 'fcm', active: true, scope,
    bookingMethods: input.bookingMethods.join(','), transport: input.transport.trim(), pnrPrefix: input.pnrPrefix.trim().toUpperCase(),
    isDefault: input.isDefault, highRiskOnly: input.highRiskOnly,
  };
  const max = await prisma.tmcProviderConfig.aggregate({ _max: { sortOrder: true } });
  await prisma.tmcProviderConfig.upsert({
    where: { code }, update: data, create: { code, ...data, sortOrder: (max._max.sortOrder ?? 0) + 1 },
  });
  // At most one default provider across the registry.
  if (input.isDefault) await prisma.tmcProviderConfig.updateMany({ where: { code: { not: code } }, data: { isDefault: false } });
}

export async function setTmcProviderActive(id: string, active: boolean): Promise<void> {
  await prisma.tmcProviderConfig.update({ where: { id }, data: { active } });
}

export async function deleteTmcProvider(id: string): Promise<void> {
  await prisma.tmcProviderConfig.delete({ where: { id } });
}

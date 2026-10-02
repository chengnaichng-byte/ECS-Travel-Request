// Reads/updates the runtime Pre-Trip Module Settings row (TR-19). Isolated in a
// dedicated module settings service linked to shared ECS config by ID (§8.3, §13.18).
import { prisma } from '@/shared/db';
import { moduleSettingsDefaults } from '@/config/decisions';

export type ModuleSettings = Awaited<ReturnType<typeof getSettings>>;

export async function getSettings() {
  const s = await prisma.moduleSettings.findUnique({ where: { id: 'SETTINGS' } });
  if (s) return s;
  // self-heal if the seed has not run
  return prisma.moduleSettings.create({ data: { id: 'SETTINGS', ...moduleSettingsDefaults } });
}

export async function updateSettings(patch: Record<string, unknown>) {
  return prisma.moduleSettings.update({ where: { id: 'SETTINGS' }, data: patch });
}

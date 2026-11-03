// Seeds the runtime ModuleSettings row from §3.4 defaults. Reference masters
// (expense types, caps, ODA rates, workflow bands, FX, roles, etc.) are NOT seeded
// into the database — per §13.18 they are read-only config in src/data consumed via
// the mock ECS services. This keeps the pre-trip module free of a second master list.
import { PrismaClient } from '@prisma/client';
import { moduleSettingsDefaults as d } from '../src/config/decisions';
import { defaultPurposeCostItems } from '../src/data/purposeCostItems';

const prisma = new PrismaClient();

async function main() {
  await prisma.moduleSettings.upsert({
    where: { id: 'SETTINGS' },
    update: {},
    create: { id: 'SETTINGS', ...d },
  });
  console.log('Seeded ModuleSettings (SETTINGS).');

  // §4.4 Purpose cost-item profiles — upsert the factory defaults (idempotent; admin edits are kept
  // because we only upsert the known default keys and never delete).
  for (const it of defaultPurposeCostItems) {
    await prisma.purposeCostItem.upsert({
      where: { purposeId_expenseTypeId: { purposeId: it.purposeId, expenseTypeId: it.expenseTypeId } },
      update: {},
      create: it,
    });
  }
  console.log(`Seeded PurposeCostItem (${defaultPurposeCostItems.length} rows).`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

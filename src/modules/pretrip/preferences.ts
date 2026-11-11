// §4.1 Per-staff UI preferences (prototype). Keyed by the employee id / persona. The only
// preference so far is the default state of the left navigation menu app-wide: "shown" (docked
// full width) or "hidden" (collapsed to the slim icon rail). Read server-side by the Shell so the
// sidebar renders in the right state with no flash; maintained from the Staff Profile page.
import { prisma } from '@/shared/db';

export type SidebarDefault = 'shown' | 'hidden';

export interface StaffPreferences {
  sidebarDefault: SidebarDefault;
}

const DEFAULTS: StaffPreferences = { sidebarDefault: 'shown' };

export async function getStaffPreferences(employeeId: string): Promise<StaffPreferences> {
  const row = await prisma.staffPreference.findUnique({ where: { employeeId } });
  if (!row) return DEFAULTS;
  return { sidebarDefault: row.sidebarDefault === 'hidden' ? 'hidden' : 'shown' };
}

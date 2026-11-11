// §4.1 Per-staff UI preferences (prototype). Keyed by the employee id / persona. The only
// preference so far is the default state of the left navigation menu app-wide:
//   "shown"  — docked full width (icons + labels)
//   "icons"  — slim icon rail (icons only, labels hidden)
//   "hidden" — removed entirely (the header menu button reveals it)
// Read server-side by the Shell so the sidebar renders in the right state with no flash; maintained
// from the Staff Profile page.
import { prisma } from '@/shared/db';

export type SidebarDefault = 'shown' | 'icons' | 'hidden';

export interface StaffPreferences {
  sidebarDefault: SidebarDefault;
}

const DEFAULTS: StaffPreferences = { sidebarDefault: 'shown' };

export function asSidebarDefault(v: string | null | undefined): SidebarDefault {
  return v === 'hidden' || v === 'icons' ? v : 'shown';
}

export async function getStaffPreferences(employeeId: string): Promise<StaffPreferences> {
  const row = await prisma.staffPreference.findUnique({ where: { employeeId } });
  if (!row) return DEFAULTS;
  return { sidebarDefault: asSidebarDefault(row.sidebarDefault) };
}

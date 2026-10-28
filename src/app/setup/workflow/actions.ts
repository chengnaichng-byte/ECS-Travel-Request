'use server';
// §6.2 Workflow Configuration maintenance (Setup & Maintenance). Admin-gated edit (ECS "Edit workflow
// rule": approval tiers + decision points) and enable/disable of the TR approval-workflow scenario.
import { revalidatePath } from 'next/cache';
import { currentPersona } from '@/shared/session';
import { ROLE } from '@/shared/enums';
import { saveWorkflowScenario, setWorkflowScenarioEnabled } from '@/modules/pretrip/workflowConfig';
import type { WorkflowScenario } from '@/config/workflowScenario';

async function isAdmin(): Promise<boolean> {
  const p = await currentPersona();
  return p.roles.includes(ROLE.TravelAdmin) || p.roles.includes(ROLE.SystemAdmin);
}

export async function saveWorkflowScenarioAction(json: string) {
  if (!(await isAdmin())) return;
  let s: WorkflowScenario;
  try { s = JSON.parse(json); } catch { return; }
  if (!s?.code) return;
  await saveWorkflowScenario(s);
  revalidatePath('/setup/workflow');
  revalidatePath(`/setup/workflow/${s.code}`);
}

export async function toggleWorkflowScenarioAction(id: string, enabled: boolean) {
  if (!(await isAdmin())) return;
  await setWorkflowScenarioEnabled(id, enabled);
  revalidatePath('/setup/workflow');
}

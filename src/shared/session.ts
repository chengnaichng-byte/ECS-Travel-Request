// Current persona (role/context) for the prototype — driven by a cookie set by the
// role switcher (§4.1). In OutSystems this is the authenticated ECS user; here it
// lets the demo switch between the §13.7 personas without a login.
import { cookies } from 'next/headers';
import { EcsIdentity } from '@/shared/ecs/services';

const COOKIE = 'ecs_persona';
const ROLE_COOKIE_NAME = 'ecs_role';
const DEFAULT_PERSONA = 'E-TRAV';

export async function currentPersonaId(): Promise<string> {
  const store = await cookies();
  return store.get(COOKIE)?.value ?? DEFAULT_PERSONA;
}

/** The role the current persona is acting under (drives the "Acting as" role dropdown). */
export async function currentRoleId(): Promise<string | null> {
  const store = await cookies();
  return store.get(ROLE_COOKIE_NAME)?.value ?? null;
}

export async function currentPersona() {
  const id = await currentPersonaId();
  return EcsIdentity.employee(id) ?? EcsIdentity.employee(DEFAULT_PERSONA)!;
}

export const PERSONA_COOKIE = COOKIE;
export const ROLE_COOKIE = ROLE_COOKIE_NAME;

'use client';
// §4.1 role/context switcher — two linked dropdowns: the first picks the ECS ROLE, the
// second picks the PERSON assigned that role (both extended for the Pre-Trip module).
// Selecting a role filters the person list to those assigned it. Applies the choice by
// calling the setPersona server action directly (sets the persona + role cookies).
import { useState, useTransition } from 'react';
import { setPersona } from '@/app/actions';
import { STAGE_LABELS, STAGE_ORDER, type RoleStage } from '@/data/personaRoles';

interface Person { id: string; name: string; title: string }
interface RoleOpt { key: string; label: string; note: string; stage: RoleStage }

export function PersonaSwitcher({ role, person, roles, peopleByRole }: {
  role: string; person: string;
  roles: RoleOpt[];
  peopleByRole: Record<string, Person[]>;
}) {
  const [r, setR] = useState(role);
  const [p, setP] = useState(person);
  const [, start] = useTransition();

  const people = peopleByRole[r] ?? [];
  const personVal = people.some((x) => x.id === p) ? p : (people[0]?.id ?? '');

  const apply = (roleKey: string, personId: string) => {
    const fd = new FormData();
    fd.set('roleId', roleKey);
    fd.set('personaId', personId);
    start(() => setPersona(fd));
  };

  const onRole = (nr: string) => {
    const first = (peopleByRole[nr] ?? [])[0]?.id ?? '';
    setR(nr); setP(first);
    if (first) apply(nr, first);
  };
  const onPerson = (id: string) => { setP(id); apply(r, id); };

  const cls = 'bg-white text-[var(--ecs-text)] text-sm rounded px-2 py-1.5 border border-[var(--ecs-border)] outline-none focus:border-[var(--ecs-navy)] focus:ring-1 focus:ring-[var(--ecs-navy)]';
  const roleNote = roles.find((x) => x.key === r)?.note;

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-[var(--ecs-muted)] hidden sm:inline">Acting as</span>
      <select aria-label="Role" title={roleNote} value={r} onChange={(e) => onRole(e.target.value)} className={`${cls} max-w-[150px] sm:max-w-[220px]`}>
        {STAGE_ORDER.filter((s) => roles.some((x) => x.stage === s)).map((s) => (
          <optgroup key={s} label={STAGE_LABELS[s]}>
            {roles.filter((x) => x.stage === s).map((x) => <option key={x.key} value={x.key} title={x.note}>{x.label}</option>)}
          </optgroup>
        ))}
      </select>
      <select aria-label="Person" value={personVal} onChange={(e) => onPerson(e.target.value)} disabled={people.length === 0} className={`${cls} max-w-[150px] sm:max-w-[230px]`}>
        {people.length === 0
          ? <option value="">— no one assigned —</option>
          : people.map((x) => <option key={x.id} value={x.id}>{x.name} — {x.title}</option>)}
      </select>
    </div>
  );
}

'use client';
// §4.1 Staff Profile control for the default state of the left navigation menu (app-wide).
// A segmented two-option control. Selecting an option saves it immediately (server action), which
// revalidates the layout so the Shell re-reads it and the menu updates on the spot. Optimistic so
// the selection shows at once; it reverts if the save fails.
import { useState, useTransition } from 'react';
import { setSidebarDefault } from '@/app/actions';

type Value = 'shown' | 'hidden';
const OPTIONS: { value: Value; label: string; desc: string }[] = [
  { value: 'shown', label: 'Shown', desc: 'The side menu is docked open on every page.' },
  { value: 'hidden', label: 'Hidden (icon rail)', desc: 'The side menu starts collapsed to the slim icon rail; the header menu button opens it.' },
];

export function SidebarDefaultPref({ value }: { value: Value }) {
  const [current, setCurrent] = useState<Value>(value);
  const [pending, startTransition] = useTransition();

  function choose(v: Value) {
    if (v === current) return;
    const prev = current;
    setCurrent(v); // optimistic
    const fd = new FormData();
    fd.set('sidebarDefault', v);
    startTransition(async () => {
      try { await setSidebarDefault(fd); }
      catch { setCurrent(prev); } // revert on failure
    });
  }

  return (
    <div>
      <div role="radiogroup" aria-label="Default side menu" className="inline-flex rounded-lg border border-[var(--ecs-border)] bg-[var(--ecs-panel)] p-0.5">
        {OPTIONS.map((o) => {
          const active = current === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => choose(o.value)}
              disabled={pending}
              className={`px-3.5 py-1.5 text-sm font-medium rounded-md transition ${active ? 'bg-white text-[var(--ecs-navy)] shadow-sm border border-[var(--ecs-border)]' : 'text-[var(--ecs-muted)] hover:text-[var(--ecs-navy)]'} ${pending ? 'opacity-70 cursor-wait' : ''}`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <p className="text-[13px] text-[var(--ecs-muted)] mt-2 leading-snug">{OPTIONS.find((o) => o.value === current)?.desc}</p>
    </div>
  );
}

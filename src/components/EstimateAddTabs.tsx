'use client';
// TR-05..08 "Add a cost line" — the add-forms as a tabbed section that guides the requestor to add
// one expense category at a time. All tabs are COLLAPSED on load; clicking a tab reveals that one
// form, clicking it again collapses it. ODA is not a tab — it is derived automatically from the trip
// and shown in the summary above. Each tab's form is kept mounted (hidden when inactive) so a part-
// filled entry survives a tab switch.
import { useState } from 'react';

export function EstimateAddTabs({ tabs, hint }: {
  tabs: { key: string; label: string; node: React.ReactNode }[];
  hint?: React.ReactNode;
}) {
  const [active, setActive] = useState<string | null>(null);
  return (
    <div className="card">
      <div className="card-head">Add a cost line</div>
      <div className="p-4">
        <div className="flex flex-wrap gap-1 border-b border-[var(--ecs-border)]">
          {tabs.map((t) => (
            <button key={t.key} type="button" aria-expanded={active === t.key}
              onClick={() => setActive((a) => (a === t.key ? null : t.key))}
              className={`px-3 py-1.5 -mb-px text-sm rounded-t-md border-b-2 cursor-pointer ${active === t.key
                ? 'border-[var(--ecs-navy)] text-[var(--ecs-navy)] font-medium bg-[var(--ecs-panel-2)]'
                : 'border-transparent text-[var(--ecs-muted)] hover:text-[var(--ecs-text)]'}`}>
              {t.label}
            </button>
          ))}
        </div>
        {active === null && (
          <p className="text-xs text-[var(--ecs-muted)] mt-3">{hint ?? 'Select a cost type above to add it.'}</p>
        )}
        {tabs.map((t) => (
          <div key={t.key} hidden={active !== t.key} className="mt-4">{t.node}</div>
        ))}
      </div>
    </div>
  );
}

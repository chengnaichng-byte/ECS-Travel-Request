'use client';
// TR-05..08 "Estimated Travel Cost Items" + inline "Add a cost line" — the cost-items table and its
// add-forms share ONE card. The add tabs (Airfare / Accommodation / Other) sit on the LEFT of the
// card's header bar, beside the title, with an emphasised orange "＋" so the add action is obvious.
// All tabs are COLLAPSED on load; clicking a tab reveals that one form below the table, clicking it
// again collapses it. A short inline note explains what is auto-populated and how to edit. ODA is not
// a tab — it is derived automatically from the trip. Each tab's form is kept mounted (hidden when
// inactive) so a part-filled entry survives a switch.
import { useEffect, useState } from 'react';

export function EstimateCostAdd({ title, tabs, defaultActive, editSignal, children }: {
  title: string;
  tabs: { key: string; label: string; node: React.ReactNode }[];
  defaultActive?: string | null; // open this tab on load (e.g. when editing a line)
  // Changes whenever the edit target changes (the ?edit line id, '' when not editing). Clicking a
  // line's Edit is a SOFT navigation that re-renders this mounted component with a new defaultActive
  // but does NOT re-run useState's initializer — so without this the pre-filled edit form never opens.
  // Re-sync the open tab to defaultActive on every edit-target change (and on cancel, which clears it).
  editSignal?: string;
  children: React.ReactNode;     // the cost-items table (rendered bare, without its own card)
}) {
  const [active, setActive] = useState<string | null>(defaultActive ?? null);
  useEffect(() => { setActive(defaultActive ?? null); }, [editSignal, defaultActive]);
  return (
    <section id="add-cost" className="card">
      <div className="card-head flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <span>{title}</span>
          {/* Add-line tabs — left of the header bar, beside the title, with an orange ＋ emphasis. */}
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Add a cost line">
            {tabs.map((t) => {
              const on = active === t.key;
              return (
                <button key={t.key} type="button" aria-expanded={on}
                  onClick={() => setActive((a) => (a === t.key ? null : t.key))}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-[#ea580c] cursor-pointer transition-colors text-white font-semibold shadow-sm ${on
                    ? 'bg-[#c2410c]'
                    : 'bg-[#ea580c] hover:bg-[#c2410c]'}`}>
                  <span aria-hidden className="text-[15px] leading-none font-bold">＋</span>{t.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="p-4">
        {/* The expandable add/edit form sits ABOVE the summary cost table. */}
        {active !== null && (
          <div className="mb-4 pb-4 border-b border-[var(--ecs-border)]">
            {tabs.map((t) => (
              <div key={t.key} hidden={active !== t.key}>{t.node}</div>
            ))}
          </div>
        )}
        {/* What is auto-populated, and how to edit — tied to the orange ＋ accent above. */}
        <div className="mb-3 flex items-start gap-2 rounded-md border border-[#fde3c4] bg-[#fff7ed] px-3 py-2 text-xs text-[#9a4a12]">
          <span aria-hidden className="text-[#ea580c] font-bold leading-none mt-0.5">ℹ</span>
          <span>Accommodation and daily allowance (ODA) are <b>auto-populated from your itinerary</b> — one line per city/country. Use the <b className="text-[#c2410c]">＋</b> buttons above to add airfare or other costs; to change an auto line, expand its row below (hotel rate is editable there) or adjust the trip dates to recompute it.</span>
        </div>
        {children}
      </div>
    </section>
  );
}

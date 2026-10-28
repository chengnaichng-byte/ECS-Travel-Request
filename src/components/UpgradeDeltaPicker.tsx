'use client';
// #14 Travel-class upgrade differential (M6) account picker. One row per NTU-funded upgrade airfare
// line: shows the derived split (chosen / entitlement / differential + applied uplift %) and lets the
// traveller select which M6 account for the governing business area the differential charges. The
// amount is derived — only the account is chosen. Auto-persists on change via the bound server action.
import { useTransition } from 'react';

export interface UpgradePickLine {
  expenseId: string;
  route: string;
  fromClassName: string;
  toClassName: string;
  fareSgd: number;
  entitlementSgd: number;
  deltaSgd: number;
  upliftPct: number | null;
  currentCode: string | null;
}

const fmt = (n: number) => 'SGD ' + n.toLocaleString('en-SG', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export function UpgradeDeltaPicker({ requestId, lines, pool, canEdit, govBAName, action }: {
  requestId: string;
  lines: UpgradePickLine[];
  pool: { code: string; name: string }[];
  canEdit: boolean;
  govBAName: string;
  action: (id: string, expenseId: string, code: string) => Promise<void>;
}) {
  const [pending, start] = useTransition();
  const multi = pool.length > 1;
  return (
    <div className="space-y-3">
      {lines.map((l) => {
        const needsPick = !l.currentCode && multi;
        return (
          <div key={l.expenseId} className="text-sm">
            <div className="mb-1">{l.route} · <strong>{l.toClassName}</strong>
              <span className="text-[var(--ecs-muted)]"> — chosen {fmt(l.fareSgd)}, entitlement {fmt(l.entitlementSgd)}, differential {fmt(l.deltaSgd)}{l.upliftPct != null ? ` · ${Math.round(l.upliftPct * 100)}% uplift (${l.fromClassName}→${l.toClassName})` : ''}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[var(--ecs-muted)] whitespace-nowrap">Charge differential to M6 account ({govBAName}):</span>
              <select
                className="field w-auto"
                disabled={!canEdit || pending}
                value={l.currentCode ?? ''}
                onChange={(e) => start(() => action(requestId, l.expenseId, e.target.value))}
              >
                <option value="">{multi ? 'Select M6 account…' : '—'}</option>
                {pool.map((a) => <option key={a.code} value={a.code}>({a.code}) {a.name}</option>)}
              </select>
              {needsPick && <span className="pill-stop">Selection required</span>}
              {l.currentCode && <span className="pill-pass">Routed to {l.currentCode}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

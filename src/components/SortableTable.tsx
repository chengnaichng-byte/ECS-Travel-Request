'use client';
// Generic sortable table (Phase 2) for SERVER-rendered pages. The server keeps rendering each row's
// <td> cells (Links, pills, formatting) and passes them as `cells`, together with plain `sort` values
// per column. This thin client wrapper renders the header with SortableTh and reorders the rows on
// click — without re-implementing any cell rendering. Sort is by raw value (see useTableSort).
import { useMemo, type ReactNode } from 'react';
import { useTableSort, SortableTh, type SortState } from './tableSort';

export interface SortCol {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;   // default true; false renders a plain header
}
export interface SortRow {
  key: string;                                      // react key (stable across reorders)
  sort: Record<string, string | number | null>;    // raw comparable value per sortable column key
  cells: ReactNode;                                 // the server-rendered <td>…</td> fragment
  className?: string;
}

export function SortableTable({ columns, rows, initialSort, tableClassName = 'w-full text-sm border-collapse', emptyText, foot }: {
  columns: SortCol[];
  rows: SortRow[];
  initialSort: SortState;
  tableClassName?: string;
  emptyText?: string;
  foot?: ReactNode;   // an optional <tfoot> (e.g. a totals row) rendered after the sorted body
}) {
  const accessors = useMemo(
    () => Object.fromEntries(
      columns.filter((c) => c.sortable !== false).map((c) => [c.key, (r: SortRow) => r.sort[c.key] ?? null]),
    ),
    [columns],
  );
  const { sorted, sort, toggle } = useTableSort(rows, accessors, initialSort);
  return (
    <table className={tableClassName}>
      <thead>
        <tr>
          {columns.map((c) =>
            c.sortable === false
              ? <th key={c.key} className={`th ${c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''}`}>{c.label}</th>
              : <SortableTh key={c.key} sortKey={c.key} sort={sort} onSort={toggle} align={c.align}>{c.label}</SortableTh>,
          )}
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => <tr key={r.key} className={r.className}>{r.cells}</tr>)}
        {sorted.length === 0 && <tr><td className="td text-[var(--ecs-muted)]" colSpan={columns.length}>{emptyText ?? 'Nothing to show.'}</td></tr>}
      </tbody>
      {foot}
    </table>
  );
}

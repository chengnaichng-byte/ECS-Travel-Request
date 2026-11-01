'use client';
// Reusable client-side table sorting (Phase 1). A two-state toggle: clicking a column header sorts
// ascending, clicking again flips to descending. Sorting is done on RAW comparable values supplied
// per column (never the formatted display string), so "SGD 9,000" vs "SGD 10,000" and dates order
// correctly. Nulls/blanks sort last in BOTH directions; the sort is stable (ties keep input order).
import { useMemo, useState, type ReactNode } from 'react';

export type SortDir = 'asc' | 'desc';
export interface SortState<K extends string = string> { key: K; dir: SortDir }
export type Accessor<T> = (row: T) => string | number | null | undefined;

function isBlank(v: string | number | null | undefined): boolean {
  return v == null || v === '';
}

/** Sort `rows` by the active column's accessor. The sortable column keys are inferred from the
 *  `accessors` object (columns without an accessor simply aren't sortable). `accessors` should be
 *  stable across renders (define it at module scope or wrap it in useMemo in the caller). */
export function useTableSort<T, A extends Record<string, Accessor<T>>>(
  rows: T[],
  accessors: A,
  initial: SortState<Extract<keyof A, string>>,
) {
  type K = Extract<keyof A, string>;
  const [sort, setSort] = useState<SortState<K>>(initial);
  // Two-state: same column flips direction; a new column starts ascending.
  const toggle = (key: K) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  const sorted = useMemo(() => {
    const acc = accessors[sort.key];
    if (!acc) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return rows
      .map((row, i) => ({ row, i }))
      .sort((a, b) => {
        const av = acc(a.row), bv = acc(b.row);
        const ab = isBlank(av), bb = isBlank(bv);
        if (ab || bb) return ab && bb ? a.i - b.i : ab ? 1 : -1;   // blanks always last
        let cmp: number;
        if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
        else cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
        return cmp !== 0 ? cmp * dir : a.i - b.i;                  // stable tie-break
      })
      .map((d) => d.row);
    // accessors assumed stable (see jsdoc) — intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort.key, sort.dir]);

  return { sorted, sort, toggle };
}

/** A clickable column header. Renders the plain label when not sortable (no onSort/sortKey). */
export function SortableTh<K extends string>({ sortKey, sort, onSort, children, align = 'left', disabled = false, className = '' }: {
  sortKey: K;
  sort: SortState<K>;
  onSort: (key: K) => void;
  children: ReactNode;
  align?: 'left' | 'right' | 'center';
  disabled?: boolean;
  className?: string;
}) {
  const active = sort.key === sortKey;
  const caret = active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕';
  const justify = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start';
  const alignCls = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : '';
  return (
    <th className={`th ${alignCls} ${className}`} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        disabled={disabled}
        className={`inline-flex items-center gap-1 w-full ${justify} font-semibold hover:text-[var(--ecs-navy)] disabled:cursor-not-allowed ${active ? 'text-[var(--ecs-navy)]' : ''}`}
        title={disabled ? undefined : `Sort by ${typeof children === 'string' ? children : sortKey}`}
      >
        <span>{children}</span>
        <span className={`text-[10px] leading-none ${active ? 'opacity-100' : 'opacity-40'}`} aria-hidden="true">{caret}</span>
      </button>
    </th>
  );
}

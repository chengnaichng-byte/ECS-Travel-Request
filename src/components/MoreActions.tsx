'use client';
// "More Actions ▾" dropdown for the request action bar — Download PDF, Recall,
// Copy to new request, Close, Add additional approver. Shown for every viewer (not
// just approvers); Recall (= withdrawal) is enabled only while not fully approved.
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { withdrawRequest, copyToNewRequest, cancelRequest } from '@/modules/pretrip/actions';

export function MoreActions({ id, canRecall, canCancel }: { id: string; canRecall: boolean; canCancel?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const item = 'w-full text-left px-3 py-2 text-sm hover:bg-[var(--ecs-panel)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2';

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="btn-secondary">More Actions ▾</button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 bg-white border border-[var(--ecs-border)] rounded-md shadow-lg z-40 py-1">
          <a href={`/requests/${id}/pack`} target="_blank" rel="noopener" className={item}>⭳ Approval pack (PDF)</a>
          <form action={withdrawRequest.bind(null, id)}><button disabled={!canRecall} className={item}>↩ Recall</button></form>
          {canCancel && <form action={cancelRequest.bind(null, id)}><button className={`${item} text-[var(--ecs-red)]`}>⊘ Cancel request</button></form>}
          <form action={copyToNewRequest.bind(null, id)}><button className={item}>⧉ Copy to new request</button></form>
          <Link href="/dashboard" className={item}>✕ Close</Link>
          <button disabled title="Additional-approver concept not enabled in Module Settings" className={item}>＋ Add additional approver(s)</button>
        </div>
      )}
    </div>
  );
}

'use client';
// A collapsible "add estimate line" panel: the button toggles the form open/closed, and the form
// auto-collapses after a SUCCESSFUL add. A validation failure redirects (throwing NEXT_REDIRECT),
// so the panel correctly stays open in that case and the error is shown.
import { useState } from 'react';

export function AddEstimatePanel({ action, label, children }: {
  action: (fd: FormData) => Promise<void>;
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`inline-flex items-center gap-1 cursor-pointer select-none w-max text-sm ${open ? 'btn-secondary' : 'btn-primary'}`}
      >
        {open ? '✕ Close' : `＋ ${label}`}
      </button>
      {open && (
        <form action={async (fd) => { await action(fd); setOpen(false); }} className="space-y-3 mt-3">
          {children}
        </form>
      )}
    </>
  );
}

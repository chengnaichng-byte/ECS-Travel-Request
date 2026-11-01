'use client';
// §4.5 The accommodation Save/Add button disables itself when the quoted nightly rate is ABOVE the
// city cap and the line carries neither a written justification nor the Conference-hotel tick (the
// same gate the server enforces). It watches its own form's rate / justification / conference-hotel
// fields. The cap is fixed for an auto per-stop hotel (fixedCap); for a manual line it follows the
// selected city (caps map × the form's city select).
import { useEffect, useRef, useState } from 'react';

export function HotelSaveButton({ caps, fixedCap, label }: {
  caps: Record<string, number>; fixedCap?: number; label: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const btn = ref.current;
    const form = btn?.form;
    if (!form) return;
    const recompute = () => {
      const rate = Number((form.querySelector('[name="quotedNightly"]') as HTMLInputElement | null)?.value ?? '0');
      const justification = String((form.querySelector('[name="notes"]') as HTMLInputElement | null)?.value ?? '').trim();
      const conf = (form.querySelector('[name="conferenceHotel"]') as HTMLInputElement | null)?.checked ?? false;
      const citySel = form.querySelector('[name="city"]') as HTMLSelectElement | null;
      const cap = fixedCap != null ? fixedCap : (citySel ? (caps[citySel.value] ?? 0) : 0);
      setBlocked(cap > 0 && rate > cap && !justification && !conf);
    };
    recompute();
    form.addEventListener('input', recompute);
    form.addEventListener('change', recompute);
    return () => { form.removeEventListener('input', recompute); form.removeEventListener('change', recompute); };
  }, [caps, fixedCap]);
  return (
    <button ref={ref} type="submit" disabled={blocked}
      className={`btn-primary ${blocked ? 'opacity-50 cursor-not-allowed' : ''}`}
      title={blocked ? 'The nightly rate is above the city cap — add a justification or tick “Conference hotel” to save.' : undefined}>
      {label}
    </button>
  );
}

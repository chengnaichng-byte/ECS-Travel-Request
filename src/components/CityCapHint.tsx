'use client';
// §4.5 Shows only the APPLICABLE hotel cap for the accommodation line's city. For an auto per-stop
// hotel the city is fixed (fixedCity/fixedCap). For a manual line it follows the form's city select,
// updating as the city changes. Caps are pre-resolved (city cap, else the country fallback).
import { useEffect, useRef, useState } from 'react';

export function CityCapHint({ caps, cityNames, fixedCity, fixedCap }: {
  caps: Record<string, number>; cityNames: Record<string, string>; fixedCity?: string; fixedCap?: number;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [v, setV] = useState<{ name: string; cap: number }>(() => ({
    name: fixedCity ? (cityNames[fixedCity] ?? fixedCity) : '',
    cap: fixedCap ?? (fixedCity ? (caps[fixedCity] ?? 0) : 0),
  }));
  useEffect(() => {
    if (fixedCity != null) return; // auto line — the cap is fixed
    const form = ref.current?.closest('form');
    if (!form) return;
    const recompute = () => {
      const code = (form.querySelector('[name="city"]') as HTMLSelectElement | null)?.value ?? '';
      setV({ name: cityNames[code] ?? code, cap: caps[code] ?? 0 });
    };
    recompute();
    form.addEventListener('change', recompute);
    form.addEventListener('input', recompute);
    return () => { form.removeEventListener('change', recompute); form.removeEventListener('input', recompute); };
  }, [caps, cityNames, fixedCity]);
  return <p ref={ref}><b>City cap:</b> {v.name ? <>{v.name} S${v.cap}</> : '—'}</p>;
}

'use client';
import { useState } from 'react';

/** Lists destination cities. When there are more than `max`, it shows the first `max` with a
 *  "…+N more" toggle; clicking it reveals the full list (and "less" collapses it again). Used for
 *  multi-city itineraries where the full set of destinations may not fit the available space. */
export function DestinationList({ cities, max = 3 }: { cities: string[]; max?: number }) {
  const [open, setOpen] = useState(false);
  if (cities.length === 0) return <>Not specified</>;
  if (cities.length <= max) return <>{cities.join(', ')}</>;
  const btn = 'ml-1 text-[var(--ecs-navy-2)] hover:underline font-medium whitespace-nowrap';
  return open ? (
    <>{cities.join(', ')} <button type="button" onClick={() => setOpen(false)} className={btn}>less</button></>
  ) : (
    <>{cities.slice(0, max).join(', ')}<button type="button" onClick={() => setOpen(true)} className={btn} title={cities.join(', ')}>…+{cities.length - max} more</button></>
  );
}

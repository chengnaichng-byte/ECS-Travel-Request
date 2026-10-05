'use client';
// §2.2 Booking arrangement + TMC booking method — two linked fields on the Trip form.
// The arrangement is how the trip is fulfilled (Auto/TMC provider, or self-booked /
// host-arranged / no booking). The TMC booking method is only enabled for a TMC
// arrangement; otherwise it shows "— not applicable —".
import { useState } from 'react';

export interface ProviderOpt { id: string; name: string }
export interface MethodOpt { value: string; label: string }

const isTmc = (arr: string) => arr === 'AUTO' || arr.startsWith('TMC-');

export function BookingFields({ providers, nonTmc, methods, initialArrangement, initialMethod, disabled }: {
  providers: ProviderOpt[];
  nonTmc: MethodOpt[];
  methods: MethodOpt[];
  initialArrangement: string;
  initialMethod: string;
  disabled?: boolean;
}) {
  const [arr, setArr] = useState(initialArrangement || 'AUTO');
  const tmc = isTmc(arr);
  return (
    <>
      <div>
        <label className="label">Booking arrangement (§2.2)</label>
        <select name="bookingArrangement" value={arr} disabled={disabled} onChange={(e) => setArr(e.target.value)} className="field">
          <option value="AUTO">Auto — route by policy (TMC)</option>
          {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option disabled>──────────</option>
          {nonTmc.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <p className="text-xs text-[var(--ecs-muted)] mt-1">A TMC (Auto routes by destination &amp; policy, or pick a provider) or a non-TMC arrangement.</p>
      </div>
      <div>
        <label className="label">TMC booking method</label>
        <select name="bookingMethod" defaultValue={tmc ? initialMethod : ''} disabled={disabled || !tmc} className="field">
          {tmc ? <option value="">Select…</option> : <option value="">— not applicable —</option>}
          {tmc && methods.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <p className="text-xs text-[var(--ecs-muted)] mt-1">{tmc ? 'The channel the TMC uses to fulfil the booking.' : 'Only applies when the trip is arranged via a TMC.'}</p>
      </div>
    </>
  );
}

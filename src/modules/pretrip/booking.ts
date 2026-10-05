// §2.2 Booking arrangement helpers. The arrangement decides how a trip is fulfilled —
// via a TMC (AUTO = provider chosen by policy, or a specific provider id) or a non-TMC
// arrangement (self-booked / host-arranged / no booking). The TMC booking method (channel)
// only applies to a TMC arrangement.
import { BOOKING_ARRANGEMENT, BOOKING_METHOD_LABEL } from '@/shared/enums';
import { tmcProvider } from '@/data/tmcProviders';

/** True when the trip is arranged via a TMC (Auto or a specific provider). Null/unset
 *  defaults to Auto (a TMC arrangement). */
export function isTmcArrangement(arr?: string | null): boolean {
  return !arr || arr === BOOKING_ARRANGEMENT.Auto || arr.startsWith('TMC-');
}
export function isSelfBooked(arr?: string | null): boolean { return arr === BOOKING_ARRANGEMENT.SelfBooked; }
export function isHostArranged(arr?: string | null): boolean { return arr === BOOKING_ARRANGEMENT.HostArranged; }
export function isNoBooking(arr?: string | null): boolean { return arr === BOOKING_ARRANGEMENT.NoBooking; }

/** The explicitly-preferred TMC provider id from the arrangement (AUTO → null = auto-route). */
export function providerFromArrangement(arr?: string | null): string | null {
  return arr && arr.startsWith('TMC-') ? arr : null;
}

/** Human label for a booking arrangement. */
export function arrangementLabel(arr?: string | null): string {
  if (!arr || arr === BOOKING_ARRANGEMENT.Auto) return 'Auto — route by policy (TMC)';
  if (arr.startsWith('TMC-')) return tmcProvider(arr)?.name ?? arr;
  return BOOKING_METHOD_LABEL[arr] ?? arr;
}

/** Combined display, e.g. "FCM Travel (Primary) · TMC agent-assisted" or "Self-booked". */
export function bookingSummaryText(arr?: string | null, method?: string | null): string {
  const base = arrangementLabel(arr);
  return isTmcArrangement(arr) && method ? `${base} · ${BOOKING_METHOD_LABEL[method] ?? method}` : base;
}

// §13.9 / DD-18 Deterministic hand-off routing. The TMC channel a booking is handed off on is
// derived from how DETERMINISTIC the itinerary is, not chosen freely:
//   • a simple, single-traveller, closed-loop itinerary with no personal extension is
//     machine-bookable → straight-through TMC ONLINE;
//   • any variation the online self-service channel cannot reliably price/hold — a group block,
//     per-traveller dates / sub-itineraries, a personal extension, a complex multi-city / open-jaw,
//     or a guest profile the TMC must collect — forces AGENT-ASSISTED;
//   • an offline-only requirement (policy or explicit) forces the OFFLINE channel.
// Enforced at hand-off (the channel on the outbound instruction) and surfaced in the UI.
import { POLICY_OUTCOME, BOOKING_METHOD } from '@/shared/enums';
import { sharedLegs } from './group';
import { isGuestRequest } from './traveller';
import type { FullRequest } from './queries';

export type HandoffChannel = 'TMC_ONLINE' | 'AGENT_ASSISTED' | 'OFFLINE';

export interface HandoffAssessment {
  deterministic: boolean;      // true = straight-through online is safe
  channel: HandoffChannel;     // the enforced channel
  forced: boolean;             // true = the channel was forced by a variation / offline need
  reasons: string[];           // the variations that prevent straight-through (empty when deterministic)
}

/** Air legs in order. */
function airLegs(req: FullRequest) {
  return sharedLegs(req).filter((l) => l.transportMode === 'AIR').sort((a, b) => a.seq - b.seq);
}

/** A group whose travellers do not all fly the identical shared itinerary (per-traveller dates,
 *  sub-itineraries or an explicit override note) — §13.20. */
function groupItineraryVaries(req: FullRequest): boolean {
  if (!req.isGroup) return false;
  const ownDates = req.travellers.some((t) => t.ownStartDate != null || t.ownEndDate != null || (t.legOverrideNote ?? '').trim() !== '');
  const subItineraryLegs = req.legs.some((l) => l.travellerId != null);
  return ownDates || subItineraryLegs;
}

/** A personal extension anywhere on the trip (request-level or a personal leg). */
function hasPersonalTravel(req: FullRequest): boolean {
  return req.personalStart != null || req.personalEnd != null || req.legs.some((l) => l.isPersonal);
}

/** Complex / open-jaw air itinerary the online channel cannot reliably self-price. */
function isComplexItinerary(req: FullRequest): boolean {
  if (req.tripType === 'MULTI_CITY') return true;
  const legs = airLegs(req);
  if (legs.length < 2) return false;
  // Open-jaw: a non-one-way trip whose last leg does not return to the first origin.
  if (req.tripType !== 'ONE_WAY' && legs[0].originCode !== legs[legs.length - 1].destCode) return true;
  return false;
}

/** Offline-only requirement — an explicit offline method or an OFFLINE policy exception. */
function requiresOffline(req: FullRequest): boolean {
  if (req.bookingMethod === BOOKING_METHOD.Offline) return true;
  return req.policyChecks.some((c) => c.code === 'OFFLINE' && c.outcome === POLICY_OUTCOME.Exception);
}

/** §13.9 / DD-18 Assess the deterministic hand-off channel for a request. */
export function assessHandoffRouting(req: FullRequest): HandoffAssessment {
  if (requiresOffline(req)) {
    return { deterministic: false, forced: true, channel: 'OFFLINE', reasons: ['Offline booking required (policy / selected channel)'] };
  }
  const reasons: string[] = [];
  if (req.isGroup && req.travellers.length > 1) reasons.push(`Group block booking (${req.travellers.length} travellers) — held space / group fare`);
  if (groupItineraryVaries(req)) reasons.push('Per-traveller dates / sub-itineraries differ across the group (§13.20)');
  if (hasPersonalTravel(req)) reasons.push('Personal extension on the itinerary — fare split / stopover');
  if (isComplexItinerary(req)) reasons.push('Complex multi-city / open-jaw itinerary');
  if (isGuestRequest(req)) reasons.push('Guest booking — the TMC collects the traveller profile');

  const deterministic = reasons.length === 0;
  return {
    deterministic,
    forced: !deterministic,
    channel: deterministic ? 'TMC_ONLINE' : 'AGENT_ASSISTED',
    reasons,
  };
}

/** Short human label for a channel. */
export function channelLabel(c: HandoffChannel): string {
  return c === 'TMC_ONLINE' ? 'TMC online (straight-through)' : c === 'AGENT_ASSISTED' ? 'TMC agent-assisted' : 'Offline (TMC)';
}

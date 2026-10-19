// §13.x / DD-23 Emergency lane (book first, raise later) shared helpers.
import type { FullRequest } from './queries';
import { BOOKING_METHOD } from '@/shared/enums';

// The docType for the mandatory email approval that must be attached to an emergency request
// (the authorising officer's e-mail that authorised booking ahead of the full approval cycle).
export const EMERGENCY_APPROVAL_DOC = 'Emergency Approval Email';

// §13.x / DD-23 The emergency lane is a book-first lane: only a TMC channel where a human agent
// can hold/place a booking ahead of approval qualifies. A self-service online tool cannot.
export const EMERGENCY_BOOKING_METHODS: string[] = [BOOKING_METHOD.AgentAssisted, BOOKING_METHOD.Offline];

/** True when the request's booking method supports the emergency (book-first) lane. */
export function emergencyMethodAllowed(req: { bookingMethod?: string | null }): boolean {
  return !!req.bookingMethod && EMERGENCY_BOOKING_METHODS.includes(req.bookingMethod);
}

// §13.x / DD-23 When an emergency is raised OUTSIDE the standard lead-time window (plenty of
// runway to the earliest departure), the soft gate requires a fuller written justification.
export const EMERGENCY_OOW_MIN_JUSTIFICATION = 40; // minimum characters

type LeadReq = Pick<FullRequest, 'startDate'> & { legs?: { departDate: Date | null; isPersonal?: boolean }[] };

/** Earliest departure across the itinerary legs, falling back to the trip start date. */
export function earliestDeparture(req: LeadReq): Date | null {
  const dates: Date[] = (req.legs ?? []).map((l) => l.departDate).filter((d): d is Date => !!d);
  if (req.startDate) dates.push(req.startDate);
  if (!dates.length) return null;
  return new Date(Math.min(...dates.map((d) => new Date(d).getTime())));
}

/** Whole-day lead time from `from` (default now) to the earliest departure; null when undated. */
export function leadTimeDays(req: LeadReq, from: Date = new Date()): number | null {
  const dep = earliestDeparture(req);
  if (!dep) return null;
  return Math.floor((dep.getTime() - from.getTime()) / 86400000);
}

/** True when the trip is WITHIN the standard emergency window (short lead → genuine emergency).
 *  Undated requests are treated as within-window (no objective basis to gate). */
export function withinEmergencyWindow(req: LeadReq, windowDays: number, from?: Date): boolean {
  const lt = leadTimeDays(req, from);
  return lt == null ? true : lt <= windowDays;
}

/** True when the request carries the mandatory emergency email-approval attachment. */
export function hasEmergencyApproval(req: { attachments: { docType: string }[] }): boolean {
  return req.attachments.some((a) => a.docType === EMERGENCY_APPROVAL_DOC);
}

/** An emergency request may be booked before DOA ratification on the named officer's authority. */
export function isEmergencyBookFirst(req: Pick<FullRequest, 'isEmergency' | 'emergencyAuthoriserId'>): boolean {
  return !!req.isEmergency && !!req.emergencyAuthoriserId;
}

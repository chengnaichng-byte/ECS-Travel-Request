// §7.3 OBT / TMC industry-standard vocabularies for the inbound feed, kept DISTINCT from ECS's own
// booking lifecycle. The feed reports an OBT booking-record status + GDS segment/coupon status codes;
// ECS maps the OBT status onto its internal BOOKING_STATUS for the request/booking lifecycle.
import { BOOKING_STATUS } from '@/shared/enums';

// ---- A. OBT / TMC booking-record lifecycle status (SAP Concur / Amadeus cytric / GDS PNR lifecycle) ----
export const OBT_BOOKING_STATUS = {
  InProgress: 'IN_PROGRESS', Queued: 'QUEUED', TravellerActionRequired: 'TRAVELLER_ACTION_REQUIRED',
  Held: 'HELD', Confirmed: 'CONFIRMED', Ticketed: 'TICKETED', PartiallyTicketed: 'PARTIALLY_TICKETED',
  Waitlisted: 'WAITLISTED', ScheduleChange: 'SCHEDULE_CHANGE', Reissued: 'REISSUED',
  Cancelled: 'CANCELLED', Voided: 'VOIDED', Refunded: 'REFUNDED', Expired: 'EXPIRED',
  Rejected: 'REJECTED', Failed: 'FAILED', NoShow: 'NO_SHOW', Completed: 'COMPLETED',
} as const;
export type ObtBookingStatus = (typeof OBT_BOOKING_STATUS)[keyof typeof OBT_BOOKING_STATUS];
export const OBT_BOOKING_STATUS_VALUES = Object.values(OBT_BOOKING_STATUS);
export const OBT_BOOKING_STATUS_LABEL: Record<string, string> = {
  IN_PROGRESS: 'In progress', QUEUED: 'Queued (agent action)', TRAVELLER_ACTION_REQUIRED: 'Traveller action required',
  HELD: 'Held (TTL)', CONFIRMED: 'Confirmed', TICKETED: 'Ticketed', PARTIALLY_TICKETED: 'Partially ticketed',
  WAITLISTED: 'Waitlisted', SCHEDULE_CHANGE: 'Schedule change', REISSUED: 'Reissued / exchanged',
  CANCELLED: 'Cancelled', VOIDED: 'Voided', REFUNDED: 'Refunded', EXPIRED: 'Expired (hold lapsed)',
  REJECTED: 'Rejected', FAILED: 'Failed', NO_SHOW: 'No-show', COMPLETED: 'Completed / flown',
};

/** Map an OBT booking-record status onto ECS's internal booking lifecycle (TravelBooking.status). */
export function obtToEcsBookingStatus(obt: string): string {
  switch (obt) {
    case 'IN_PROGRESS': case 'QUEUED': return BOOKING_STATUS.InProgress;
    case 'TRAVELLER_ACTION_REQUIRED': return BOOKING_STATUS.TravellerActionRequired;
    case 'PARTIALLY_TICKETED': case 'WAITLISTED': return BOOKING_STATUS.PartiallyBooked;
    case 'HELD': case 'CONFIRMED': case 'TICKETED': case 'SCHEDULE_CHANGE': case 'REISSUED': return BOOKING_STATUS.Booked;
    case 'CANCELLED': case 'VOIDED': case 'REFUNDED': case 'EXPIRED': return BOOKING_STATUS.Cancelled;
    case 'REJECTED': case 'FAILED': return BOOKING_STATUS.Failed;
    case 'NO_SHOW': case 'COMPLETED': return BOOKING_STATUS.TravelCompleted;
    default: return BOOKING_STATUS.Booked;
  }
}

// ---- B. GDS air-segment status (action / advice) codes — per segment ----
export const SEGMENT_STATUS_LABEL: Record<string, string> = {
  HK: 'Confirmed', HL: 'Waitlisted', HN: 'Need (pending)', HS: 'Sold (pending)', KK: 'Confirming',
  KL: 'Confirming from waitlist', TK: 'Schedule change — confirmed', TL: 'Schedule change — waitlist',
  UN: 'Unable — carrier cancelled', UC: 'Unable — waitlist closed', US: 'Unable — waitlisted',
  NO: 'No action', SC: 'Schedule change', HX: 'Cancelled', WK: 'Was confirmed (sched change)',
  WL: 'Was waitlisted', WN: 'Was need',
};
export const SEGMENT_STATUS_VALUES = Object.keys(SEGMENT_STATUS_LABEL);

// ---- C. E-ticket coupon status — per coupon (ties a flight segment to the ticket/charge) ----
export const COUPON_STATUS_LABEL: Record<string, string> = {
  O: 'Open for use', F: 'Flown / used', E: 'Exchanged', R: 'Refunded', V: 'Void', A: 'Airport control',
  C: 'Checked-in', L: 'Lifted / boarded', S: 'Suspended', P: 'Printed', I: 'Irregular ops',
};
export const COUPON_STATUS_VALUES = Object.keys(COUPON_STATUS_LABEL);

// ---- D. Booking channel / source ----
export const OBT_CHANNEL = { Online: 'ONLINE', Offline: 'OFFLINE', Mobile: 'MOBILE', OfflineSupport: 'OFFLINE_SUPPORT', SupplierDirect: 'SUPPLIER_DIRECT' } as const;
export const OBT_CHANNEL_VALUES = Object.values(OBT_CHANNEL);

// ---- E. Cancellation / change reason ----
export const CANCEL_REASON = { TravellerRequest: 'TRAVELLER_REQUEST', ScheduleChange: 'SCHEDULE_CHANGE', SupplierCancelled: 'SUPPLIER_CANCELLED', PolicyDeclined: 'POLICY_DECLINED', ApprovalRejected: 'APPROVAL_REJECTED', Duplicate: 'DUPLICATE', NoLongerRequired: 'NO_LONGER_REQUIRED', FareExpired: 'FARE_EXPIRED', ForceMajeure: 'FORCE_MAJEURE' } as const;
export const CANCEL_REASON_VALUES = Object.values(CANCEL_REASON);

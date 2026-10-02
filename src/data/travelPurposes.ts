// §2.1 Travel Purpose — REUSED from the ECS master (Setup & Maintenance › Travel
// Purpose). Mirrors the ECS list verbatim: name, GL account code, allowed expense
// types and Active/Inactive status. The pre-trip module adds only its extension
// attributes (research indicator, pre-trip-mandatory, TE-linkage requirement, allowed
// booking methods) — it does NOT maintain a second purpose list (§13.18, AC02).
import { BOOKING_METHOD } from '@/shared/enums';

export interface TravelPurpose {
  id: string;
  name: string;
  glAccountCode: string;           // ECS GL account code
  expenseTypes: string;            // ECS allowed expense types (descriptor)
  active: boolean;                 // ECS status (Active / Inactive)
  // ---- pre-trip extension attributes ----
  isResearch: boolean;             // '- Research Staff' purposes route via the Research DOA line
  preTripMandatory: boolean;
  teLinkageRequired: boolean;      // used when module setting = CONDITIONAL (§13.8)
  allowedBookingMethods: string[];
}

// Standard overseas travel expense types carried by the active business/training purposes.
const EXP_STD = 'Airport / Train Transfer; Hotel / Accommodation (Overseas); Overseas Daily Allowance (ODA)';
const TMC_METHODS = [BOOKING_METHOD.TMCOnline, BOOKING_METHOD.AgentAssisted, BOOKING_METHOD.Offline, BOOKING_METHOD.SelfBooked];

export const travelPurposes: TravelPurpose[] = [
  { id: 'TP-OB-ACAD',  name: 'Official Business - Acad Staff',        glAccountCode: '75120011', expenseTypes: EXP_STD, active: true,  isResearch: false, preTripMandatory: true,  teLinkageRequired: true,  allowedBookingMethods: TMC_METHODS },
  { id: 'TP-OB-ADMIN', name: 'Official Business - Admin Staff',       glAccountCode: '75120021', expenseTypes: EXP_STD, active: true,  isResearch: false, preTripMandatory: true,  teLinkageRequired: true,  allowedBookingMethods: TMC_METHODS },
  { id: 'TP-OB-RES',   name: 'Official Business - Research Staff',     glAccountCode: '75120031', expenseTypes: EXP_STD, active: true,  isResearch: true,  preTripMandatory: true,  teLinkageRequired: true,  allowedBookingMethods: TMC_METHODS },
  { id: 'TP-RETREAT',  name: 'Retreats',                              glAccountCode: '75120040', expenseTypes: '',       active: true,  isResearch: false, preTripMandatory: true,  teLinkageRequired: false, allowedBookingMethods: [BOOKING_METHOD.TMCOnline, BOOKING_METHOD.SelfBooked, BOOKING_METHOD.HostArranged] },
  { id: 'TP-STUDENT',  name: 'Student Travel',                        glAccountCode: '75110070', expenseTypes: '',       active: false, isResearch: false, preTripMandatory: false, teLinkageRequired: false, allowedBookingMethods: [BOOKING_METHOD.TMCOnline, BOOKING_METHOD.SelfBooked] },
  { id: 'TP-TC-ACAD',  name: 'Training/Conference - Acad Staff',      glAccountCode: '72000161', expenseTypes: EXP_STD, active: true,  isResearch: false, preTripMandatory: true,  teLinkageRequired: true,  allowedBookingMethods: TMC_METHODS },
  { id: 'TP-TC-ADMIN', name: 'Training/Conference - Admin Staff',     glAccountCode: '72000171', expenseTypes: EXP_STD, active: true,  isResearch: false, preTripMandatory: true,  teLinkageRequired: true,  allowedBookingMethods: TMC_METHODS },
  { id: 'TP-TC-RES',   name: 'Training/Conference - Research Staff',   glAccountCode: '72000181', expenseTypes: EXP_STD, active: true,  isResearch: true,  preTripMandatory: true,  teLinkageRequired: true,  allowedBookingMethods: TMC_METHODS },
  { id: 'TP-VISIT',    name: 'Visiting Academic Travel - Speaker, NRP', glAccountCode: '75100040', expenseTypes: '',    active: false, isResearch: false, preTripMandatory: false, teLinkageRequired: false, allowedBookingMethods: [BOOKING_METHOD.TMCOnline, BOOKING_METHOD.SelfBooked] },
];

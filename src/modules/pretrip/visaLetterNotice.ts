// §4.13 Visa-letter HR notification datapoints — the EXACT set and order of the NTU visa-letter
// template (NTU Visa Letter_<date>.xlsx). Only these fields are carried, in this column order, so the
// HR notification payload and the downloaded Excel match the agreed format. Built once here so both agree.
import { EcsReference, EcsIdentity, EcsCharging } from '@/shared/ecs/services';
import { travellerName } from './traveller';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dd = (d: Date) => String(d.getUTCDate()).padStart(2, '0');
const fmtDay = (d: Date | null) => (d ? `${dd(d)} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : '—');
/** "03 - 08 November 2026" (same month); "03 November - 02 December 2026" (same year); else full. */
function fmtRange(s: Date | null, e: Date | null): string {
  if (!s || !e) return s ? fmtDay(s) : '—';
  const sy = s.getUTCFullYear(), ey = e.getUTCFullYear(), sm = s.getUTCMonth(), em = e.getUTCMonth();
  if (sy === ey && sm === em) return `${dd(s)} - ${dd(e)} ${MONTHS[sm]} ${sy}`;
  if (sy === ey) return `${dd(s)} ${MONTHS[sm]} - ${dd(e)} ${MONTHS[em]} ${sy}`;
  return `${fmtDay(s)} - ${fmtDay(e)}`;
}

export interface VisaLetterRecord {
  travelerSubmitDate: string;
  preTripRequestBookingId: string;
  employeeName: string;
  emailAddress: string;
  companyCode: string;
  businessArea: string;
  wbsCostCentre: string;
  visaLetterRequired: string;
  destinationCity: string;
  tripDates: string;
}

export interface VisaLetterReq {
  requestNumber: string;
  travellerType?: string | null;
  travellerId: string;
  guestName?: string | null;
  guestEmail?: string | null;
  destCity: string | null;
  startDate: Date | null;
  endDate: Date | null;
  allocations: { chargingCode: string; isMain?: boolean; percent?: number }[];
  versions?: { reason: string; createdAt: Date }[];
}

/** The visa-letter record for one request — exactly the NTU template's datapoints. */
export function buildVisaLetterRecord(req: VisaLetterReq): VisaLetterRecord {
  const emp = EcsIdentity.employee(req.travellerId);
  const main = req.allocations.find((a) => a.isMain) ?? [...req.allocations].sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0))[0];
  const code = main?.chargingCode ?? '';
  const master = code ? EcsCharging.code(code) : undefined;
  const submit = req.versions?.find((v) => v.reason === 'SUBMISSION')?.createdAt ?? null;
  return {
    travelerSubmitDate: fmtDay(submit),
    preTripRequestBookingId: req.requestNumber,
    employeeName: travellerName(req),
    emailAddress: emp?.email ?? req.guestEmail ?? '—',
    companyCode: EcsIdentity.entity().name,                                  // the company (NTU)
    businessArea: master?.businessArea ?? '—',                              // SAP business area of the main charging account
    wbsCostCentre: master ? `${master.code} ${master.name}` : (code || '—'), // main charging account (CC/WBS) + name
    visaLetterRequired: 'Yes',
    destinationCity: EcsReference.city(req.destCity ?? '')?.name ?? req.destCity ?? '—',
    tripDates: fmtRange(req.startDate, req.endDate),
  };
}

/** Column order + the exact NTU-template headers for the HR Excel attachment. */
export const VISA_LETTER_COLUMNS: { key: keyof VisaLetterRecord; header: string }[] = [
  { key: 'travelerSubmitDate', header: 'Traveler Submit Date' },
  { key: 'preTripRequestBookingId', header: 'Pre-Trip Request Booking ID' },
  { key: 'employeeName', header: 'Employee Name' },
  { key: 'emailAddress', header: 'Email Address' },
  { key: 'companyCode', header: 'Company Code' },
  { key: 'businessArea', header: 'Business Area' },
  { key: 'wbsCostCentre', header: 'WBS/Cost Centre' },
  { key: 'visaLetterRequired', header: 'Visa Letter Required = "Yes"' },
  { key: 'destinationCity', header: 'Destination City' },
  { key: 'tripDates', header: 'Start and End Dates of Trip' },
];

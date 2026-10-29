// §4.13 Visa-letter notification record — the fields HR needs to draft the support letter for a staff
// visa application: who is travelling (and their employing entity / department), where and when, the
// purpose, the invitation / event context, and who bears the cost (the institution — employer-sponsored)
// with the funding source. Built once here so the HR notification payload and the Excel export agree.
import { EcsReference, EcsIdentity } from '@/shared/ecs/services';
import { travellerName } from './traveller';

const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : '—');

export interface VisaLetterRecord {
  travelRequestRef: string;
  authorisationNumber: string | null;
  traveller: string;
  employingEntity: string;
  department: string;
  destination: string;
  travelDates: string;
  travelPurpose: string;
  invitationReference: string;
  eventDates: string;
  costBorneBy: string;
  fundingSource: string;
  notifiedHr: string;
}

export interface VisaLetterReq {
  requestNumber: string;
  authorisationNo: string | null;
  travellerType?: string | null;
  travellerId: string;
  guestName?: string | null;
  departmentId: string | null;
  destCity: string | null;
  destCountry: string | null;
  startDate: Date | null;
  endDate: Date | null;
  purposeId: string | null;
  invitationRef: string | null;
  eventStartDate: Date | null;
  eventEndDate: Date | null;
  visaLetterNotifiedAt: Date | null;
  allocations: { chargingCode: string }[];
}

/** The visa-letter record for one request — the content of the HR notification / Excel row. */
export function buildVisaLetterRecord(req: VisaLetterReq): VisaLetterRecord {
  const city = EcsReference.city(req.destCity ?? '')?.name ?? req.destCity ?? '—';
  const country = EcsReference.country(req.destCountry ?? '')?.name ?? '';
  const entity = EcsIdentity.entity().name;
  return {
    travelRequestRef: req.requestNumber,
    authorisationNumber: req.authorisationNo,
    traveller: travellerName(req),
    employingEntity: entity,
    department: EcsIdentity.department(req.departmentId ?? '')?.name ?? '—',
    destination: `${city}${country ? `, ${country}` : ''}`,
    travelDates: `${d(req.startDate)} → ${d(req.endDate)}`,
    travelPurpose: EcsReference.travelPurpose(req.purposeId ?? '')?.name ?? '—',
    invitationReference: req.invitationRef?.trim() || '—',
    eventDates: req.eventStartDate ? `${d(req.eventStartDate)} → ${d(req.eventEndDate)}` : '—',
    costBorneBy: `${entity} (employer-sponsored)`,
    fundingSource: req.allocations.map((a) => a.chargingCode).join(', ') || '—',
    notifiedHr: d(req.visaLetterNotifiedAt),
  };
}

/** Column order + human headers for the Excel export (the HR email attachment). */
export const VISA_LETTER_COLUMNS: { key: keyof VisaLetterRecord; header: string }[] = [
  { key: 'travelRequestRef', header: 'Travel Request' },
  { key: 'authorisationNumber', header: 'Travel Authorisation' },
  { key: 'traveller', header: 'Traveller' },
  { key: 'employingEntity', header: 'Employing entity' },
  { key: 'department', header: 'Department' },
  { key: 'destination', header: 'Destination' },
  { key: 'travelDates', header: 'Travel dates' },
  { key: 'travelPurpose', header: 'Purpose of travel' },
  { key: 'invitationReference', header: 'Invitation reference' },
  { key: 'eventDates', header: 'Event dates' },
  { key: 'costBorneBy', header: 'Cost borne by' },
  { key: 'fundingSource', header: 'Funding source (CC/WBS)' },
  { key: 'notifiedHr', header: 'Notified HR' },
];

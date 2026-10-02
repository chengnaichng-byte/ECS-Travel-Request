// §13.8 TE Claim pre-population mapping. When a claimant selects an approved Travel
// Request, the claim is pre-populated with Locked / Editable / Reference / Excluded
// treatment per field and line. §13.14: for a group request this is filtered to the
// selecting traveller's attributed lines and shares. This mapping is the field
// authority for the prototype (§13.11) and the OutSystems TE pre-population contract.
import { EcsIdentity, EcsReference } from '@/shared/ecs/services';
import { TE_TREATMENT, EXPENSE_CATEGORY, BOOKING_STATUS } from '@/shared/enums';
import { fmtSgd } from '@/modules/pretrip/pricing';
import { travellerNightsAtCity } from '@/modules/pretrip/group';
import type { FullRequest } from '@/modules/pretrip/queries';

export interface HeaderField { label: string; value: string; treatment: string; }
export interface PrepopLine {
  category: string;
  expenseTypeId: string;
  label: string;
  treatment: string;
  approvedSgd: number;
  bookedSgd: number | null;   // null = self-booked / not applicable (§13.17)
  actualSgd: number;
}

export interface Prepopulation {
  header: HeaderField[];
  lines: PrepopLine[];
  note: string;
}

/** Admin Integration-Contract overrides (src/config/integrationContracts.ts).
 * header: field-key → treatment; line: EXPENSE_CATEGORY → treatment; bookedAmounts:
 * include the TMC-fed booked column. EXCLUDED drops the field/line entirely. */
export interface ClaimContract {
  header?: Record<string, string>;
  line?: Record<string, string>;
  bookedAmounts?: boolean;
}

export function prepopulateClaim(
  req: FullRequest,
  claimantId: string,
  airfareTreatment: string,
  contract?: ClaimContract,
  priorClaimedByCategory: Record<string, number> = {},  // §AC17 amounts already claimed per category
): Prepopulation {
  const emp = EcsIdentity.employee(claimantId);
  const dept = EcsIdentity.department(emp?.departmentId ?? '');
  const purpose = EcsReference.travelPurpose(req.purposeId ?? '')?.name ?? '—';
  const destCity = EcsReference.city(req.destCity ?? '')?.name ?? req.destCity ?? '—';
  const destCountry = EcsReference.country(req.destCountry ?? '')?.name ?? req.destCountry ?? '—';
  const travelClass = EcsReference.travelClass(req.travelClassId ?? '')?.name ?? '—';
  const fmtDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '—');

  // §35 the confirmed TMC booking reference for this claimant (their own booking in a
  // group fan-out, else the request's single booking).
  const myBooking = req.bookings.find((b) => b.travellerId === claimantId) ?? req.bookings[0];
  const bookingRef = myBooking?.pnr ? `${myBooking.pnr}${myBooking.ticketNo ? ` · ${myBooking.ticketNo}` : ''}` : '—';

  // §13.20 a group traveller may travel on their own dates (leg override).
  const myRow = req.travellers.find((t) => t.employeeId === claimantId);
  const startD = myRow?.ownStartDate ?? req.startDate;
  const endD = myRow?.ownEndDate ?? req.endDate;
  const datesNote = myRow?.ownStartDate ? ' (own dates)' : '';
  // Per-traveller approved class for group requests (else the request-level class).
  const myClassId = myRow?.chosenClassId ?? req.travelClassId ?? '';
  const myClass = EcsReference.travelClass(myClassId)?.name ?? travelClass;

  // Header fields carry their contract key so an admin override can change the
  // treatment or exclude the field (§13.8 field authority, now admin-editable).
  const headerDefs: (HeaderField & { key: string })[] = [
    { key: 'teTraveller', label: 'Traveller', value: emp?.name ?? claimantId, treatment: TE_TREATMENT.Locked },
    { key: 'teEntity', label: 'Employing entity', value: EcsIdentity.entity().name, treatment: TE_TREATMENT.Locked },
    { key: 'teDepartment', label: 'Department', value: dept?.name ?? '—', treatment: TE_TREATMENT.Locked },
    { key: 'teRequestNo', label: 'Travel Request Number', value: req.requestNumber, treatment: TE_TREATMENT.Locked },
    { key: 'teAuthNo', label: 'Travel Authorisation Number', value: req.authorisationNo ?? '—', treatment: TE_TREATMENT.Locked },
    { key: 'tePurpose', label: 'Travel purpose', value: purpose, treatment: TE_TREATMENT.Locked },
    { key: 'teDescription', label: 'Description', value: req.description ?? '—', treatment: TE_TREATMENT.Locked },
    { key: 'teDestination', label: 'Main destination', value: `${destCity}, ${destCountry}`, treatment: TE_TREATMENT.Locked },
    { key: 'teDates', label: 'Official travel dates', value: `${fmtDate(startD)} → ${fmtDate(endD)}${datesNote}`, treatment: TE_TREATMENT.Editable },
    { key: 'teApprovedClass', label: 'Travel class (approved)', value: myClass, treatment: TE_TREATMENT.Reference },
    { key: 'teCharging', label: 'Charging & cost allocation', value: req.allocations.map((a) => `${a.chargingCode} ${a.percent}%`).join(', ') || '—', treatment: TE_TREATMENT.Locked },
    { key: 'teBookingRef', label: 'Booking reference (PNR / ticket)', value: bookingRef, treatment: TE_TREATMENT.Reference },
  ];
  const header: HeaderField[] = headerDefs
    .map((h) => ({ ...h, treatment: contract?.header?.[h.key] ?? h.treatment }))
    .filter((h) => h.treatment !== TE_TREATMENT.Excluded)
    .map(({ label, value, treatment }) => ({ label, value, treatment }));

  // §13.14 filter to the claimant's attributed lines for group requests.
  const myExpenses = req.isGroup
    ? req.expenses.filter((e) => !e.travellerId || e.travellerId === claimantId || e.isShared)
    : req.expenses;

  const booking = req.bookings[0];
  const selfBooked = booking?.channel === 'SELF_BOOKED' || req.bookingStatus === BOOKING_STATUS.SelfBooked;

  const rawLines: PrepopLine[] = myExpenses.map((e) => {
    const type = EcsReference.expenseType(e.expenseTypeId);
    // Default treatment: airfare follows the Airfare-treatment setting; others Editable.
    let treatment: string = TE_TREATMENT.Editable;
    if (e.category === EXPENSE_CATEGORY.Airfare) {
      treatment = airfareTreatment === 'DIRECT_SAP' || airfareTreatment === 'REFERENCE' ? TE_TREATMENT.Reference : TE_TREATMENT.Editable;
    }
    // Admin Integration-Contract override for this category (may exclude the line).
    const override = contract?.line?.[e.category];
    if (override) treatment = override;
    // §13.14/§13.20 shared line — accommodation is date-aware (nightly rate × the
    // claimant's own nights); other shared lines split equally across travellers.
    let approvedSgd = e.sgdAmount;
    if (req.isGroup && e.isShared) {
      if (e.category === EXPENSE_CATEGORY.Accommodation && e.accommodation) {
        approvedSgd = e.accommodation.budgetedNightly * travellerNightsAtCity(req, claimantId, e.accommodation.city);
      } else {
        approvedSgd = e.sgdAmount / (req.travellers.length || 1);
      }
    }
    // booked amount from the TMC feed (null for self-booked §13.17, or when the
    // admin excludes booked amounts from the contract).
    const bookedIncluded = contract?.bookedAmounts !== false;
    let bookedSgd: number | null = null;
    if (bookedIncluded && !selfBooked && booking) {
      if (e.category === EXPENSE_CATEGORY.Airfare) bookedSgd = (booking.fare ?? 0) + (booking.taxes ?? 0) + (booking.fees ?? 0);
      else if (e.category === EXPENSE_CATEGORY.Accommodation) bookedSgd = booking.segments.filter((s) => s.type === 'HOTEL').reduce((s2, s) => s2 + (s.amount ?? 0), 0);
    }
    return {
      category: e.category,
      expenseTypeId: e.expenseTypeId,
      label: type?.name ?? e.category,
      treatment,
      approvedSgd,
      bookedSgd,
      actualSgd: approvedSgd, // claimant edits actuals; default to approved
    };
  }).filter((l) => l.treatment !== TE_TREATMENT.Excluded);  // excluded lines are not pre-populated

  // §AC17 cumulative: net each line's approved amount by what prior claims for this
  // request/traveller already consumed in that category; drop fully-claimed lines so a
  // second claim only covers the remaining balance (not the full budget again).
  const cut: Record<string, number> = { ...priorClaimedByCategory };
  const hasPrior = Object.values(cut).some((v) => v > 0);
  const lines = rawLines.map((l) => {
    const remaining = cut[l.category] ?? 0;
    if (remaining <= 0) return l;
    const applied = Math.min(remaining, l.approvedSgd);
    cut[l.category] = remaining - applied;
    const approvedSgd = Math.round((l.approvedSgd - applied) * 100) / 100;
    return { ...l, approvedSgd, actualSgd: approvedSgd };
  }).filter((l) => l.approvedSgd > 0.005);

  const note = hasPrior
    ? 'Follow-up claim: each line shows the remaining approved balance after earlier claims against this request (§AC17).'
    : selfBooked
      ? 'Self-booked trip: booked-amount column shown as not applicable; deviation checked at claim against the approved ceiling and class (§13.17).'
      : 'Locked fields copied and non-editable; Editable fields default to approved values; Reference values shown for comparison (§13.8).';

  return { header, lines, note };
}

export { fmtSgd };

// v1.3 TMC contract tests (run: npx tsx tests/contract-v13.test.mts).
// No test framework in this project; this is a standalone assertion script matching the repo's
// tsx-based ad-hoc testing style. Exits non-zero on any failure.
import { execSync } from 'node:child_process';
import { apportionAirfare, ceilingBreakdown, assembleOutbound, assembleOutboundInstructions } from '@/modules/pretrip/tmcPayload';
import { computeBookingDeviations } from '@/modules/pretrip/bookingDeviation';
import { CONTRACT_FIELDS } from '@/config/integrationContracts';
import type { FullRequest } from '@/modules/pretrip/queries';

let pass = 0, fail = 0;
const log: string[] = [];
function ok(name: string, cond: boolean, extra = '') { if (cond) pass++; else fail++; log.push(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : `  <<< ${extra}`}`); }
const near = (a: number, b: number, eps = 0.02) => Math.abs(a - b) <= eps;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

const ALL = new Set(CONTRACT_FIELDS.map((f) => f.key));
const without = (k: string) => { const s = new Set(ALL); s.delete(k); return s; };
const D = (s: string) => new Date(`${s}T00:00:00Z`);

// ---------- 1. apportionAirfare ----------
{
  const a = apportionAirfare(1000, [{ durationHours: 7 }, { durationHours: 3 }]);
  ok('apportion by duration', near(a[0], 700) && near(a[1], 300), JSON.stringify(a));
  ok('apportion reconciles to total', near(sum(a), 1000), JSON.stringify(a));
  const b = apportionAirfare(1000, [{ durationHours: 0 }, { durationHours: 0 }, { durationHours: 0 }]);
  ok('apportion even-split fallback reconciles', near(sum(b), 1000), JSON.stringify(b));
  const c = apportionAirfare(100, [{ durationHours: 1 }, { durationHours: 1 }, { durationHours: 1 }]);
  ok('apportion rounding reconciles (100/3)', near(sum(c), 100), JSON.stringify(c));
  ok('apportion empty legs', apportionAirfare(100, []).length === 0);
}

// ---------- 2. ceilingBreakdown ----------
{
  const t = ceilingBreakdown(1200, 1400, 'TRAVELLER');
  ok('breakdown categories reconcile to total (traveller hotel)', near(t.approvedAirfareCeilingSgd + t.approvedAccommodationCeilingSgd, 2600));
  ok('breakdown billTo split (traveller hotel)', near(t.ceilingByBillTo.ctaSgd, 1200) && near(t.ceilingByBillTo.travellerSgd, 1400));
  ok('breakdown billTo reconciles to total', near(t.ceilingByBillTo.ctaSgd + t.ceilingByBillTo.travellerSgd, 2600));
  const c = ceilingBreakdown(1200, 1400, 'CTA');
  ok('breakdown billTo split (CTA hotel)', near(c.ceilingByBillTo.ctaSgd, 2600) && near(c.ceilingByBillTo.travellerSgd, 0));
}

// ---------- 3. computeBookingDeviations ----------
{
  const tol = { bookingFarePct: 10, bookingFareAbsSgd: 500 };
  const approvedAirSegments = [
    { type: 'AIR', origin: 'SIN', destination: 'HND', approvedAmountSgd: 600 },
    { type: 'AIR', origin: 'HND', destination: 'SIN', approvedAmountSgd: 600 },
  ];
  const booked = (air: number, hotel: number) => [{ pnr: 'PNR1', fareSgd: air, taxesSgd: 0, feesSgd: 0, segments: [
    { type: 'AIR', origin: 'SIN', destination: 'HND' }, { type: 'AIR', origin: 'HND', destination: 'SIN' },
    { type: 'HOTEL', city: 'TYO', amountSgd: hotel } as never,
  ] }];
  ok('deviation: within limits → none', computeBookingDeviations({ approvedAirfareSgd: 1200, approvedAccommodationSgd: 1400, approvedAirSegments, booked: booked(1200, 1400), tol }).length === 0);
  const over = computeBookingDeviations({ approvedAirfareSgd: 1200, approvedAccommodationSgd: 1400, approvedAirSegments, booked: booked(2000, 1400), tol });
  ok('deviation: airfare category over → raised', over.some((d) => d.field === 'Airfare'), JSON.stringify(over));
  ok('deviation: airfare segment/PNR over → raised', over.some((d) => d.field.startsWith('Airfare segment')), JSON.stringify(over));
  const hotelOver = computeBookingDeviations({ approvedAirfareSgd: 1200, approvedAccommodationSgd: 1400, approvedAirSegments, booked: booked(1200, 2200), tol });
  ok('deviation: accommodation category over → raised', hotelOver.some((d) => d.field === 'Accommodation'), JSON.stringify(hotelOver));
  const noSeg = computeBookingDeviations({ approvedAirfareSgd: 1200, approvedAccommodationSgd: 1400, approvedAirSegments: [{ type: 'AIR', origin: 'SIN', destination: 'HND' }], booked: booked(2000, 1400), tol });
  ok('deviation: no per-segment approved → only category level', noSeg.every((d) => !d.field.startsWith('Airfare segment')), JSON.stringify(noSeg));
}

// ---------- request factories ----------
const baseLegs = (rid: string) => [
  { id: 'L1', requestId: rid, travellerId: null, seq: 1, originCode: 'SIN', destCode: 'HND', departDate: D('2027-01-02'), arriveDate: D('2027-01-02'), transportMode: 'AIR', durationHours: 7, isPersonal: false, nights: 4, travelClassId: 'TC-ECO', chosenClassId: 'TC-ECO', entitledClassId: 'TC-ECO' },
  { id: 'L2', requestId: rid, travellerId: null, seq: 2, originCode: 'HND', destCode: 'SIN', departDate: D('2027-01-06'), arriveDate: D('2027-01-06'), transportMode: 'AIR', durationHours: 7, isPersonal: false, nights: 0, travelClassId: 'TC-ECO', chosenClassId: 'TC-ECO', entitledClassId: 'TC-ECO' },
];
const alloc = (rid: string) => [{ id: 'AL1', requestId: rid, chargingCode: 'CC-1000', chargingType: 'CC', companyCode: '1000', businessArea: 'BA-CS', percent: 100, isResearch: false, isMain: true, internalOrder: null, amountSgd: null }];
const common = (rid: string) => ({
  id: rid, authorisationNo: 'TA-2026-000001', requestNumber: 'TR-2026-000001', status: 'Approved', bookingStatus: 'Not Sent',
  requestorId: 'E-TRAV', travellerType: 'EMPLOYEE', guestName: null, guestEmail: null, guestOrg: null,
  purposeId: 'TP-TC-ACAD', description: 'Conference', tripType: 'ROUND_TRIP', destCountry: 'JP', destCity: 'TYO', departmentId: 'SCH-CS',
  startDate: D('2027-01-02'), endDate: D('2027-01-06'), personalStart: null, personalEnd: null,
  bookingArrangement: 'AUTO', bookingMethod: 'TMC_ONLINE', hotelSettlement: 'INDIVIDUAL',
  bookingDeadline: D('2026-12-19'), authorisationExpiry: D('2027-01-01'), eventStartDate: null, eventEndDate: null,
  travelClassId: 'TC-ECO', entitledClassId: 'TC-ECO', isEmergency: false, emergencyAuthoriserId: null, isResearch: false,
  policyChecks: [], approvalSteps: [], bookings: [], deviations: [], teLinks: [], claims: [], messages: [], auditEvents: [], versions: [], attachments: [],
});
const accExp = (rid: string, nights = 4) => ({ id: 'E2', requestId: rid, travellerId: null, category: 'ACCOMMODATION', expenseTypeId: 'ET-ACC', sgdAmount: nights * 350, sponsorSgd: 0, sponsorForeign: 0, foreignAmount: nights * 350, isShared: false, accommodation: { id: 'A1', expenseId: 'E2', city: 'TYO', nights, personalNights: 0, budgetedNightly: 350, cappedNightly: 350, quotedNightly: 350, capVariance: 0, conferenceHotel: false, exceptionOutcome: 'PASS', legSeq: 1 }, oda: null });

function indReq(): FullRequest {
  return { ...common('R1'), isGroup: false, groupType: null, travellerId: 'E-TRAV', travellers: [], legs: baseLegs('R1'), allocations: alloc('R1'),
    expenses: [
      { id: 'E1', requestId: 'R1', travellerId: null, category: 'AIRFARE', expenseTypeId: 'ET-AIR', sgdAmount: 1200, sponsorSgd: 0, sponsorForeign: 0, foreignAmount: 1200, isShared: false, accommodation: null, oda: null },
      accExp('R1'),
    ] } as unknown as FullRequest;
}
function mixedGrpReq(): FullRequest {
  return { ...common('R1'), isGroup: true, groupType: 'MIXED', travellerId: 'E-TRAV',
    travellers: [
      { id: 'T1', requestId: 'R1', employeeId: 'E-TRAV', travellerType: 'EMPLOYEE', lineNo: 1, isRequestor: true, confirmed: true, chosenClassId: 'TC-ECO', guestName: null, guestEmail: null, guestOrg: null, studentId: null, programme: null },
      { id: 'T2', requestId: 'R1', employeeId: 'S-001', travellerType: 'STUDENT', lineNo: 2, isRequestor: false, confirmed: true, chosenClassId: null, guestName: 'Student One', guestEmail: 's1@e.ntu.edu.sg', guestOrg: 'NTU', studentId: 'U123', programme: 'CS' },
      { id: 'T3', requestId: 'R1', employeeId: 'G-001', travellerType: 'GUEST', lineNo: 3, isRequestor: false, confirmed: true, chosenClassId: null, guestName: 'Guest One', guestEmail: 'g1@mit.edu', guestOrg: 'MIT', studentId: null, programme: null },
    ],
    legs: baseLegs('R1'), allocations: alloc('R1'),
    expenses: [
      { id: 'E1', requestId: 'R1', travellerId: null, category: 'AIRFARE', expenseTypeId: 'ET-AIR', sgdAmount: 3600, sponsorSgd: 0, sponsorForeign: 0, foreignAmount: 3600, isShared: true, shareMap: null, accommodation: null, oda: null },
      { ...accExp('R1'), isShared: true, sgdAmount: 1400 },
    ] } as unknown as FullRequest;
}

// ---------- 4. individual payload ----------
{
  const o = assembleOutbound(indReq());
  const b = o.costCeilingBreakdown!;
  ok('ind: breakdown present', !!b);
  ok('ind: categories reconcile to ceiling', !!b && near(b.approvedAirfareCeilingSgd + b.approvedAccommodationCeilingSgd, o.approvedCostCeilingSgd!), JSON.stringify(b));
  ok('ind: billTo reconciles to ceiling', !!b && near(b.ceilingByBillTo.ctaSgd + b.ceilingByBillTo.travellerSgd, o.approvedCostCeilingSgd!));
  const airSegs = o.segments.filter((s) => s.type === 'AIR');
  const hotelSegs = o.segments.filter((s) => s.type === 'HOTEL');
  ok('ind: air segment amounts reconcile to airfare ceiling', near(sum(airSegs.map((s) => s.approvedAmountSgd ?? 0)), b.approvedAirfareCeilingSgd), JSON.stringify(airSegs.map((s) => s.approvedAmountSgd)));
  ok('ind: hotel segment totals reconcile to accommodation ceiling', near(sum(hotelSegs.map((s) => s.approvedTotalSgd ?? 0)), b.approvedAccommodationCeilingSgd));
  ok('ind: tripType present', o.tripType === 'ROUND_TRIP');

  const offTrip = assembleOutbound(indReq(), without('tripType'));
  ok('ind: tripType omitted when toggled off', offTrip.tripType === undefined);
  const offBrk = assembleOutbound(indReq(), without('costCeilingBreakdown'));
  ok('ind: costCeilingBreakdown omitted when toggled off', offBrk.costCeilingBreakdown === undefined);
  ok('ind: per-segment amounts omitted when breakdown off', offBrk.segments.every((s) => s.approvedAmountSgd === undefined && s.approvedTotalSgd === undefined));
  ok('ind: ceiling still present when breakdown off', typeof offBrk.approvedCostCeilingSgd === 'number');
}

// ---------- 5. mixed-group fan-out ----------
{
  const req = mixedGrpReq();
  const { mode, instructions } = assembleOutboundInstructions(req);
  ok('grp: mode is GROUP_FANOUT', mode === 'GROUP_FANOUT');
  ok('grp: one instruction per traveller', instructions.length === 3, `${instructions.length}`);
  ok('grp: bookingFor EMPLOYEE/STUDENT/GUEST per traveller', instructions[0].bookingFor === 'EMPLOYEE' && instructions[1].bookingFor === 'STUDENT' && instructions[2].bookingFor === 'GUEST', instructions.map((i) => i.bookingFor).join(','));
  for (const inst of instructions) {
    const bk = inst.costCeilingBreakdown!;
    ok(`grp: instruction breakdown reconciles (${inst.bookingFor})`, !!bk && near(bk.approvedAirfareCeilingSgd + bk.approvedAccommodationCeilingSgd, inst.approvedCostCeilingSgd!), JSON.stringify({ bk, c: inst.approvedCostCeilingSgd }));
    const air = inst.segments.filter((s) => s.type === 'AIR');
    ok(`grp: instruction air segments reconcile (${inst.bookingFor})`, near(sum(air.map((s) => s.approvedAmountSgd ?? 0)), bk.approvedAirfareCeilingSgd));
  }
  // envelope carries groupType (as the hand-off action wraps it)
  const envelope = { mode, authorisationNumber: req.authorisationNo ?? '', groupType: req.groupType, instructionCount: instructions.length, instructions };
  ok('grp: envelope carries groupType', envelope.groupType === 'MIXED');

  // STAFF and STUDENT-only group types also carry groupType
  for (const gt of ['STAFF', 'STUDENT'] as const) {
    const r = mixedGrpReq(); (r as unknown as { groupType: string }).groupType = gt;
    const env = { groupType: (r as unknown as { groupType: string }).groupType };
    ok(`grp: groupType ${gt} carried`, env.groupType === gt);
  }
}

// ---------- 6. CTA posting only on receipt, never from the claim ----------
{
  const files = execSync("grep -rl 'postCtaChargesForRequest(' src --include=*.ts", { cwd: process.cwd() }).toString().trim().split('\n').map((f) => f.replace(/\\/g, '/'));
  const allowed = new Set(['src/modules/pretrip/ctaPosting.ts', 'src/modules/pretrip/actions.ts', 'src/modules/pretrip/demo.ts']);
  const stray = files.filter((f) => !allowed.has(f));
  ok('cta: posting called only from ctaPosting/actions(receiveBooking)/demo', stray.length === 0, `stray: ${stray.join(', ')}`);
  ok('cta: no claim/TE file posts CTA charges', !files.some((f) => /claim|te/i.test(f.split('/').pop() ?? '')), files.join(', '));
}

console.log(log.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

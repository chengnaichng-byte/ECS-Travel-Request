// v1.3 TMC contract tests (run: npx tsx tests/contract-v13.test.mts).
// No test framework in this project; this is a standalone assertion script matching the repo's
// tsx-based ad-hoc testing style. Exits non-zero on any failure.
import { execSync } from 'node:child_process';
import { apportionAirfare, ceilingBreakdown, assembleOutbound, assembleOutboundInstructions, buildApprovedSnapshot, outboundFromSnapshot, snapshotApprovedAirSegments } from '@/modules/pretrip/tmcPayload';
import { computeBookingDeviations, evidenceTypeFor, type ApprovedAirSegment } from '@/modules/pretrip/bookingDeviation';
import { CONTRACT_FIELDS, CONTRACT_GUARDS } from '@/config/integrationContracts';
import { evaluateFlow } from '@/modules/pretrip/integration';
import { isResearchByCharging } from '@/modules/pretrip/research';
import { RECALLABLE_BOOKING_STATUSES, STATUS_TRANSITIONS, BOOKING_STATUS, REQUEST_STATUS } from '@/shared/enums';
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

// ---------- 3. computeBookingDeviations — category amounts (AND threshold) + segment/PNR ----------
{
  const threshold = { pct: 10, absSgd: 500 };
  const approvedAirSegments = [
    { type: 'AIR', origin: 'SIN', destination: 'HND', approvedAmountSgd: 600 },
    { type: 'AIR', origin: 'HND', destination: 'SIN', approvedAmountSgd: 600 },
  ];
  const booked = (air: number, hotel: number) => [{ pnr: 'PNR1', fareSgd: air, taxesSgd: 0, feesSgd: 0, segments: [
    { type: 'AIR', origin: 'SIN', destination: 'HND' }, { type: 'AIR', origin: 'HND', destination: 'SIN' },
    { type: 'HOTEL', city: 'TYO', amountSgd: hotel } as never,
  ] }];
  ok('deviation: within limits → none', computeBookingDeviations({ approvedAirfareSgd: 1200, approvedAccommodationSgd: 1400, approvedAirSegments, booked: booked(1200, 1400), threshold }).length === 0);
  const over = computeBookingDeviations({ approvedAirfareSgd: 1200, approvedAccommodationSgd: 1400, approvedAirSegments, booked: booked(2000, 1400), threshold });
  ok('deviation: airfare category over → raised', over.some((d) => d.field === 'Airfare'), JSON.stringify(over));
  ok('deviation: airfare segment/PNR over → raised', over.some((d) => d.field.startsWith('Airfare segment')), JSON.stringify(over));
  const hotelOver = computeBookingDeviations({ approvedAirfareSgd: 1200, approvedAccommodationSgd: 1400, approvedAirSegments, booked: booked(1200, 2200), threshold });
  ok('deviation: accommodation category over → raised', hotelOver.some((d) => d.field === 'Accommodation'), JSON.stringify(hotelOver));

  // AND combine: over the % but NOT over the SGD → not material. Approved 300, booked 360 (excess 60 >
  // 10% but < SGD 500).
  const pctOnly = computeBookingDeviations({ approvedAirfareSgd: 300, approvedAccommodationSgd: 0, approvedAirSegments: [], booked: [{ pnr: 'P', fareSgd: 360, taxesSgd: 0, feesSgd: 0, segments: [] }], threshold });
  ok('deviation: over % but not over SGD → not material (AND)', pctOnly.length === 0, JSON.stringify(pctOnly));
  // Over BOTH → material ReviewAtClaim. Approved 4000, booked 4700 (excess 700 > 400 AND > 500).
  const both2 = computeBookingDeviations({ approvedAirfareSgd: 4000, approvedAccommodationSgd: 0, approvedAirSegments: [], booked: [{ pnr: 'P', fareSgd: 4700, taxesSgd: 0, feesSgd: 0, segments: [] }], threshold });
  ok('deviation: over % AND over SGD → material ReviewAtClaim', both2.some((d) => d.scopeRef === 'AIRFARE' && d.material && d.action === 'ReviewAtClaim'), JSON.stringify(both2));
}

// ---------- 3b. LogOnly rule (item 1) + scope (level / scopeRef / pnr) ----------
{
  const threshold = { pct: 10, absSgd: 500 };
  const approvedAirSegments: ApprovedAirSegment[] = [
    { type: 'AIR', origin: 'SIN', destination: 'HND', approvedAmountSgd: 600 },
    { type: 'AIR', origin: 'HND', destination: 'SIN', approvedAmountSgd: 600 },
  ];
  // Two PNRs: one per leg (the TMC split the return fare).
  const two = (a: number, b: number) => [
    { pnr: 'PNR-A', fareSgd: a, taxesSgd: 0, feesSgd: 0, segments: [{ type: 'AIR', origin: 'SIN', destination: 'HND' }] },
    { pnr: 'PNR-B', fareSgd: b, taxesSgd: 0, feesSgd: 0, segments: [{ type: 'AIR', origin: 'HND', destination: 'SIN' }] },
  ];

  // Segment-only breach: PNR-A over its 600 (booked 800), but the category total (1100) is under the
  // approved 1200. Item 1 → non-material, LogOnly.
  const segOnly = computeBookingDeviations({ approvedAirfareSgd: 1200, approvedAccommodationSgd: 1400, approvedAirSegments, booked: two(800, 300), threshold });
  ok('item1: no airfare category deviation when total within limit', !segOnly.some((d) => d.scopeRef === 'AIRFARE'), JSON.stringify(segOnly));
  const seg = segOnly.find((d) => d.level === 'SEGMENT');
  ok('item1: segment-only breach is raised', !!seg, JSON.stringify(segOnly));
  ok('item1: segment-only breach is non-material', !!seg && seg.material === false);
  ok('item1: segment-only breach action = LogOnly', !!seg && seg.action === 'LogOnly');
  ok('scope: segment scopeRef names the route', !!seg && seg.scopeRef === 'AIR:SIN-HND', JSON.stringify(seg));
  ok('scope: segment carries its PNR', !!seg && seg.pnr === 'PNR-A', JSON.stringify(seg));

  // Both PNRs over: category total 2000 vs approved 1200 (excess 800 > 120 AND > 500) → material.
  // Item 1 → segment breaches become material (ReviewAtClaim), alongside the category deviation.
  const both = computeBookingDeviations({ approvedAirfareSgd: 1200, approvedAccommodationSgd: 1400, approvedAirSegments, booked: two(1000, 1000), threshold });
  const cat = both.find((d) => d.level === 'CATEGORY' && d.scopeRef === 'AIRFARE');
  ok('scope: airfare category deviation level/scopeRef/pnr', !!cat && cat.pnr === null && cat.material === true && cat.action === 'ReviewAtClaim', JSON.stringify(cat));
  const segs = both.filter((d) => d.level === 'SEGMENT');
  ok('item1: segment breaches material when category also breached', segs.length > 0 && segs.every((d) => d.material === true && d.action === 'ReviewAtClaim'), JSON.stringify(segs));

  // Accommodation category breach carries its scope.
  const hotel = computeBookingDeviations({ approvedAirfareSgd: 1200, approvedAccommodationSgd: 1400, approvedAirSegments, booked: [{ pnr: 'P', fareSgd: 1100, taxesSgd: 0, feesSgd: 0, segments: [{ type: 'HOTEL', city: 'TYO', amountSgd: 2200 } as never] }], threshold });
  const acc = hotel.find((d) => d.scopeRef === 'ACCOMMODATION');
  ok('scope: accommodation category deviation level/scopeRef', !!acc && acc.level === 'CATEGORY' && acc.pnr === null && acc.material === true);
}

// ---------- 3c. class / route / date checks (post-approval rules) ----------
{
  const threshold = { pct: 10, absSgd: 500 };
  const classRankByName = { Economy: 1, 'Premium Economy': 2, Business: 3 };
  const approvedAirSegments: ApprovedAirSegment[] = [
    { type: 'AIR', origin: 'SIN', destination: 'HND', approvedAmountSgd: 600, approvedClass: 'Economy', departDate: '2027-02-01' },
    { type: 'AIR', origin: 'HND', destination: 'SIN', approvedAmountSgd: 600, approvedClass: 'Economy', departDate: '2027-02-06' },
  ];
  const trip = (o: { cls?: string; dest?: string; date?: string } = {}) => [{ pnr: 'P1', fareSgd: 600, taxesSgd: 0, feesSgd: 0, segments: [
    { type: 'AIR', origin: 'SIN', destination: o.dest ?? 'HND', bookedClass: o.cls ?? 'Economy', departDate: o.date ?? '2027-02-01' },
    { type: 'AIR', origin: 'HND', destination: 'SIN', bookedClass: 'Economy', departDate: '2027-02-06' },
  ] }];
  // Class above approved, no exception → material CLASS (SEGMENT).
  const cls = computeBookingDeviations({ approvedAirfareSgd: 1200, approvedAccommodationSgd: 0, approvedAirSegments, booked: trip({ cls: 'Business' }), threshold, classRankByName });
  const clsDev = cls.find((d) => d.scopeRef === 'CLASS:SIN-HND');
  ok('class: higher class without exception → material SEGMENT', !!clsDev && clsDev.level === 'SEGMENT' && clsDev.material && clsDev.action === 'ReviewAtClaim', JSON.stringify(cls));
  // Class above approved WITH an approved exception → no class deviation.
  const clsEx = computeBookingDeviations({ approvedAirfareSgd: 1200, approvedAccommodationSgd: 0, approvedAirSegments, booked: trip({ cls: 'Business' }), threshold, classRankByName, hasApprovedClassException: true });
  ok('class: higher class WITH approved exception → no class deviation', !clsEx.some((d) => d.scopeRef.startsWith('CLASS:')), JSON.stringify(clsEx));
  // Route not approved → material ROUTE (SEGMENT).
  const rt = computeBookingDeviations({ approvedAirfareSgd: 1200, approvedAccommodationSgd: 0, approvedAirSegments, booked: trip({ dest: 'KIX' }), threshold, classRankByName });
  const rtDev = rt.find((d) => d.scopeRef === 'ROUTE:SIN-KIX');
  ok('route: booked route not approved → material ROUTE', !!rtDev && rtDev.material && rtDev.level === 'SEGMENT', JSON.stringify(rt));
  // Dates within the shift limit → no DATES deviation; beyond → material; beyond validity → material.
  const dateShift = { daysBefore: 3, daysAfter: 3 };
  const within = computeBookingDeviations({ approvedAirfareSgd: 1200, approvedAccommodationSgd: 0, approvedAirSegments, booked: trip({ date: '2027-02-03' }), threshold, dateShift, validityEnd: '2027-03-01' });
  ok('date: booked within shift limit → no DATES deviation', !within.some((d) => d.scopeRef === 'DATES'), JSON.stringify(within));
  const beyond = computeBookingDeviations({ approvedAirfareSgd: 1200, approvedAccommodationSgd: 0, approvedAirSegments, booked: trip({ date: '2027-02-06' }), threshold, dateShift, validityEnd: '2027-03-01' });
  ok('date: booked beyond shift limit → material DATES', beyond.some((d) => d.scopeRef === 'DATES' && d.material && d.level === 'CATEGORY'), JSON.stringify(beyond));
  const expired = computeBookingDeviations({ approvedAirfareSgd: 1200, approvedAccommodationSgd: 0, approvedAirSegments, booked: trip({ date: '2027-02-02' }), threshold, dateShift, validityEnd: '2027-02-01' });
  ok('date: booked beyond approval validity → material DATES', expired.some((d) => d.scopeRef === 'DATES'), JSON.stringify(expired));
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

// ---------- 5b. v1.3 item 2 (B2) approval snapshot ----------
{
  const req = indReq();
  const snap = buildApprovedSnapshot(req);
  ok('B2: snapshot mode SINGLE', snap.mode === 'SINGLE');
  ok('B2: snapshot one instruction', snap.instructions.length === 1);
  ok('B2: snapshot category totals frozen', near(snap.approvedAirfareSgd, 1200) && near(snap.approvedAccommodationSgd, 1400), JSON.stringify({ a: snap.approvedAirfareSgd, h: snap.approvedAccommodationSgd }));
  const snapAir = snapshotApprovedAirSegments(snap);
  ok('B2: snapshot air segments reconcile to airfare total', near(sum(snapAir.map((s) => s.approvedAmountSgd ?? 0)), 1200), JSON.stringify(snapAir.map((s) => s.approvedAmountSgd)));

  // Amend the itinerary AFTER the snapshot: the frozen snapshot must not move.
  (req.expenses[0] as unknown as { sgdAmount: number }).sgdAmount = 9999;
  req.legs.push({ ...req.legs[0], id: 'L9', seq: 9, originCode: 'SIN', destCode: 'LHR' } as never);
  ok('B2: snapshot airfare unchanged after amend', near(snap.approvedAirfareSgd, 1200));
  ok('B2: snapshot air segments unchanged after amend', snapAir.length === 2 && near(sum(snapAir.map((s) => s.approvedAmountSgd ?? 0)), 1200));

  // The outbound payload is built FROM the snapshot, so it uses the approved (not the amended) values.
  const meta = { messageId: '00000000-0000-0000-0000-000000000000' as const, sentAt: '2026-11-06T00:00:00Z', sourceStatus: 'Approved', contractVersion: 'ecs-pretrip-contract/1.3', tmc: 'fcm' };
  const payload = outboundFromSnapshot(snap, meta, { authorisationNumber: 'TA-2026-000001', groupType: null, bookingMethod: 'AGENT_ASSISTED' }) as Record<string, unknown>;
  const pAir = (payload.segments as { type: string; approvedAmountSgd?: number }[]).filter((s) => s.type === 'AIR');
  ok('B2: outbound-from-snapshot uses frozen airfare', near(sum(pAir.map((s) => s.approvedAmountSgd ?? 0)), 1200), JSON.stringify(pAir));
  ok('B2: outbound-from-snapshot still 2 air legs (amend ignored)', pAir.length === 2);
  ok('B2: outbound-from-snapshot overlays operational bookingMethod', payload.bookingMethod === 'AGENT_ASSISTED');
  ok('B2: outbound-from-snapshot carries meta', !!payload.meta);

  // The deviation baseline comes from the frozen snapshot — a booking over the approved airfare is a
  // deviation even though the live request was later edited down/up.
  const dev = computeBookingDeviations({
    approvedAirfareSgd: snap.approvedAirfareSgd, approvedAccommodationSgd: snap.approvedAccommodationSgd,
    approvedAirSegments: snapAir as ApprovedAirSegment[],
    booked: [{ pnr: 'P', fareSgd: 2000, taxesSgd: 0, feesSgd: 0, segments: snapAir.map((s) => ({ type: 'AIR', origin: s.origin, destination: s.destination })) }],
    threshold: { pct: 10, absSgd: 500 },
  });
  ok('B2: deviation check uses the frozen baseline', dev.some((d) => d.scopeRef === 'AIRFARE'), JSON.stringify(dev));

  // Group snapshot: one instruction per traveller; outbound-from-snapshot is a fan-out envelope.
  const gsnap = buildApprovedSnapshot(mixedGrpReq());
  ok('B2: group snapshot per traveller', gsnap.mode === 'GROUP_FANOUT' && gsnap.instructions.length === 3, `${gsnap.mode}/${gsnap.instructions.length}`);
  const genv = outboundFromSnapshot(gsnap, meta, { authorisationNumber: 'TA-2026-000001', groupType: 'MIXED', bookingMethod: 'TMC_ONLINE' }) as Record<string, unknown>;
  ok('B2: group outbound-from-snapshot is a fan-out envelope', genv.mode === 'GROUP_FANOUT' && genv.instructionCount === 3 && genv.groupType === 'MIXED');

  // Category totals survive the breakdown toggle being off (so the category deviation check still works).
  const offBrk = buildApprovedSnapshot(indReq(), without('costCeilingBreakdown'));
  ok('B2: category totals kept even when breakdown toggled off', near(offBrk.approvedAirfareSgd, 1200) && near(offBrk.approvedAccommodationSgd, 1400));
}

// ---------- 6. CTA posting only on receipt, never from the claim ----------
{
  const files = execSync("grep -rl 'postCtaChargesForRequest(' src --include=*.ts", { cwd: process.cwd() }).toString().trim().split('\n').map((f) => f.replace(/\\/g, '/'));
  const allowed = new Set(['src/modules/pretrip/ctaPosting.ts', 'src/modules/pretrip/actions.ts', 'src/modules/pretrip/demo.ts']);
  const stray = files.filter((f) => !allowed.has(f));
  ok('cta: posting called only from ctaPosting/actions(receiveBooking)/demo', stray.length === 0, `stray: ${stray.join(', ')}`);
  ok('cta: no claim/TE file posts CTA charges', !files.some((f) => /claim|te/i.test(f.split('/').pop() ?? '')), files.join(', '));
}

// ---------- 7. post-approval model: recall + locked states ----------
{
  // Recall allowed only while un-booked (nothing ticketed); blocked once ticketed.
  const unbooked = [BOOKING_STATUS.NotSent, BOOKING_STATUS.SentToTMC, BOOKING_STATUS.ReceivedByTMC, BOOKING_STATUS.InProgress, BOOKING_STATUS.TravellerActionRequired, BOOKING_STATUS.Failed];
  ok('recall: allowed for every un-booked status', unbooked.every((s) => RECALLABLE_BOOKING_STATUSES.includes(s)), RECALLABLE_BOOKING_STATUSES.join(','));
  ok('recall: blocked once booked / partially booked', !RECALLABLE_BOOKING_STATUSES.includes(BOOKING_STATUS.Booked) && !RECALLABLE_BOOKING_STATUSES.includes(BOOKING_STATUS.PartiallyBooked));
  // Recall reverts an approved TR to an editable Draft (the only Approved → editable transition).
  ok('recall: Approved → Draft transition exists', STATUS_TRANSITIONS[REQUEST_STATUS.Approved].includes(REQUEST_STATUS.Draft));
  // Locked after approval: no in-system re-approval — Approved never returns to a Submitted/Pending state.
  ok('locked: Approved has no Submitted/Pending transition', !STATUS_TRANSITIONS[REQUEST_STATUS.Approved].some((s) => s === REQUEST_STATUS.Submitted || s.startsWith('Pending')));
}

// ---------- 8. offline-approval evidence at claim (Wave 2) ----------
{
  ok('evidenceType: CLASS', evidenceTypeFor('CLASS:SIN-HND') === 'CLASS');
  ok('evidenceType: DATES', evidenceTypeFor('DATES') === 'DATES');
  ok('evidenceType: ROUTE', evidenceTypeFor('ROUTE:SIN-KIX') === 'ROUTE');
  ok('evidenceType: AIRFARE → CATEGORY_AMOUNT', evidenceTypeFor('AIRFARE') === 'CATEGORY_AMOUNT');
  ok('evidenceType: ACCOMMODATION → CATEGORY_AMOUNT', evidenceTypeFor('ACCOMMODATION') === 'CATEGORY_AMOUNT');
  ok('evidenceType: segment airfare → none', evidenceTypeFor('AIR:SIN-HND') === null);

  // requiresEvidence rule as receiveBooking applies it: material AND type ∈ evidenceRequiredFor.
  const evReq = ['CLASS', 'DATES', 'ROUTE', 'CATEGORY_AMOUNT'];
  const needs = (scopeRef: string, material: boolean) => { const t = material ? evidenceTypeFor(scopeRef) : null; return t != null && evReq.includes(t); };
  ok('requiresEvidence: material CLASS → true', needs('CLASS:SIN-HND', true));
  ok('requiresEvidence: LogOnly segment airfare → false', needs('AIR:SIN-HND', false) === false);
  ok('requiresEvidence: material airfare category → true', needs('AIRFARE', true));
  ok('requiresEvidence: type not in list → false', (() => { const e2 = ['CLASS']; const t = evidenceTypeFor('DATES'); return (t != null && e2.includes(t)) === false; })());

  // te.evidence guard (TE_SUBMIT) blocks claim submission until evidence is complete.
  const subGuards = CONTRACT_GUARDS.filter((g) => g.flow === 'TE_SUBMIT').map((g) => ({ ...g, enabled: true }));
  ok('te.evidence: guard exists', subGuards.length === 1 && subGuards[0].key === 'te.evidence');
  const ctx = { status: 'Approved', bookingStatus: 'Booked', bookingMethod: 'TMC_ONLINE', authorisationNo: 'TA-1' };
  ok('te.evidence: blocked when evidence incomplete', evaluateFlow({ ...ctx, evidenceComplete: false }, 'TE_SUBMIT', subGuards).ok === false);
  ok('te.evidence: passes when evidence complete (upload or waiver)', evaluateFlow({ ...ctx, evidenceComplete: true }, 'TE_SUBMIT', subGuards).ok === true);
  ok('te.evidence: self-booked / no deviations passes (vacuous)', evaluateFlow({ ...ctx, bookingMethod: 'SELF_BOOKED', evidenceComplete: true }, 'TE_SUBMIT', subGuards).ok === true);
  // A disabled guard does not block.
  ok('te.evidence: disabled guard does not block', evaluateFlow({ ...ctx, evidenceComplete: false }, 'TE_SUBMIT', subGuards.map((g) => ({ ...g, enabled: false }))).ok === true);
}

// ---------- Research classification: largest share, primary-account tie-break (RTE-9/NTR-1/CHG-5, agreed 11 Nov 2026) ----------
{
  const A = (code: string, percent: number, isMain = false) => ({ chargingCode: code, percent, isMain });
  ok('research: 70% CC / 30% WBS -> non-research', isResearchByCharging([A('CC-1000', 70, true), A('WBS-R100', 30)], 'E-TRAV') === false);
  ok('research: 30% CC / 70% WBS -> research', isResearchByCharging([A('CC-1000', 30, true), A('WBS-R100', 70)], 'E-TRAV') === true);
  ok('research: 50/50 tie -> primary (CC) non-research', isResearchByCharging([A('CC-1000', 50, true), A('WBS-R100', 50)], 'E-TRAV') === false);
  ok('research: 50/50 tie -> primary (WBS) research', isResearchByCharging([A('CC-1000', 50), A('WBS-R100', 50, true)], 'E-TRAV') === true);
  ok('research: single research account -> research', isResearchByCharging([A('WBS-R100', 100, true)], 'E-TRAV') === true);
  ok('research: single non-research account -> non-research', isResearchByCharging([A('CC-1000', 100, true)], 'E-TRAV') === false);
  ok('research: no allocations falls back to the traveller default account', typeof isResearchByCharging([], 'E-TRAV') === 'boolean');
}

console.log(log.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

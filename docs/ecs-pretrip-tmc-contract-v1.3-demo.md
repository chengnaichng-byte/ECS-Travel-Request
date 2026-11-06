# TMC integration contract v1.3 - demo results

This records two end-to-end runs that exercise the v1.3 contract (`ecs-pretrip-contract/1.3`)
against the prototype. Both runs seed a request, bring it to Approved with a Travel Authorisation,
and produce the outbound booking message with the real hand-off assembly (`assembleOutboundInstructions`,
the same code path as `handoffToTmc`). The outbound `IntegrationMessage` is persisted and booking status
advances to Sent to TMC.

Verification: `npx tsc --noEmit` reports 0 errors, and `npx tsx tests/contract-v13.test.mts` reports
38 passed, 0 failed.

## What v1.3 adds (recap)

- `costCeilingBreakdown` (toggle, default on): per-category ceilings (airfare, accommodation) plus a
  payment-channel split `ceilingByBillTo { ctaSgd, travellerSgd }`. `approvedCostCeilingSgd` unchanged.
- AIR segments carry `approvedAmountSgd` (airfare apportioned across legs by leg duration); HOTEL
  segments carry `approvedTotalSgd`. Both reconcile to their category ceiling.
- `tripType` (toggle, default on). `groupType` on the group fan-out envelope. `bookingFor` per traveller.
- Booking deviation now runs at category level and at segment / PNR level, matching each booked PNR to
  the approved legs it fulfils by route.

## Demo 1: group fan-out (staff group, 3 travellers)

Shared Tokyo round-trip on one TA, 60/40 cross-charge, hotel bill-to TRAVELLER (hotelSettlement INDIVIDUAL).
Outbound is a `GROUP_FANOUT` with one instruction per traveller. One instruction (all three identical here):

```json
{
  "travellerRef": "E-TRAV", "travellerName": "Dr Alice Tan", "bookingFor": "EMPLOYEE",
  "instructionSeq": 1, "instructionCount": 3, "bookingMethod": "TMC_ONLINE",
  "tripType": "ROUND_TRIP",
  "approvedCostCeilingSgd": 2600, "costShareSgd": 2600,
  "costCeilingBreakdown": {
    "approvedAirfareCeilingSgd": 1200, "approvedAccommodationCeilingSgd": 1400,
    "ceilingByBillTo": { "ctaSgd": 1200, "travellerSgd": 1400 }
  },
  "segments": [
    { "type": "AIR", "origin": "SIN", "destination": "HND", "approvedClass": "Economy", "approvedAmountSgd": 600 },
    { "type": "AIR", "origin": "HND", "destination": "SIN", "approvedClass": "Economy", "approvedAmountSgd": 600 },
    { "type": "HOTEL", "city": "TYO", "nights": 4, "cappedNightlySgd": 350, "approvedTotalSgd": 1400 }
  ]
}
```

Envelope: `{ mode: "GROUP_FANOUT", groupType: "STAFF", instructionCount: 3, instructions: [...] }`.

Reconciliation (each of the 3 instructions):

| Traveller | bookingFor | ceiling | airfare | accommodation | AIR segs sum | HOTEL sum | billTo CTA / traveller |
|---|---|---|---|---|---|---|---|
| E-TRAV | EMPLOYEE | 2600 | 1200 | 1400 | 1200 | 1400 | 1200 / 1400 |
| E-TRAV2 | EMPLOYEE | 2600 | 1200 | 1400 | 1200 | 1400 | 1200 / 1400 |
| E-TRAV4 | EMPLOYEE | 2600 | 1200 | 1400 | 1200 | 1400 | 1200 / 1400 |

- Toggle off `costCeilingBreakdown` (admin override): the field and every per-segment amount are omitted;
  `approvedCostCeilingSgd` still present.
- Inbound booked 30% over: one deviation at category level, `Airfare: approved 3600 -> booked 6903`.

## Demo 2: individual multi-city (segment-level deviation)

SIN to Tokyo to Osaka to Seoul to SIN. The airfare (2200) is apportioned across the four legs by leg
duration. Overall ceiling 4300 (airfare 2200 + accommodation 2100).

| Leg | Duration | approvedAmountSgd |
|---|---|---|
| SIN to HND | 7h | 933.33 |
| HND to KIX | 1.5h | 200.00 |
| KIX to ICN | 2h | 266.67 |
| ICN to SIN | 6h | 800.00 |

Inbound: the TMC splits the trip into two PNRs. PNR-A (first two legs) books at 1400; PNR-B at 950.

- Category check PASSES: total booked airfare 2350 is within the allowed 2400 (10% or SGD 200 tolerance).
  Under the old total-only check the trip looks fine, because PNR-B is under its approved amount and
  absorbs the overage on PNR-A.
- v1.3 segment / PNR check CATCHES it and names the leg:

```
Airfare segment (PNR TA-2026-xxxxxx-A: SIN-HND, HND-KIX): approved 1133 -> booked 1400
```

This is the gap the breakdown was built to close: an overspend on one leg is no longer hidden by savings
on another at the combined total.

## Reproduce

The demos were run with standalone `tsx` drivers (seed, assemble, deviate). The assembly code is
`src/modules/pretrip/tmcPayload.ts` (`assembleOutboundInstructions`) and the deviation logic is
`src/modules/pretrip/bookingDeviation.ts` (`computeBookingDeviations`), both covered by
`tests/contract-v13.test.mts`.

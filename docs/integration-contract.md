# ECS ⇄ TMC Canonical Integration Contract (§7.3–7.5, §13.9)

The prototype demonstrates TMC integration with **static mock payloads only** — no live
connectivity. The value of the design is that ECS publishes **one provider-neutral
canonical contract**; all provider-specific mapping lives in an adapter layer
(`src/integrations/tmc/adapter.ts`), so a future TMC change is contained to that layer
while the pre-trip process, approval workflow, policy rules, canonical model and TE
linkage stay unchanged (§7.5).

Contract types: `src/integrations/tmc/contract.ts`. Payloads are generated on approval
and rendered on the Booking Details screen (TR-14).

## Outbound (ECS → TMC)

Emitted when an approved request is handed off. Canonical fields:

| Field | ECS source |
|---|---|
| `authorisationNumber` | Pre-trip module (Travel Authorisation Number) |
| `travellerRef` / `travellers[]` | ECS / HR (group hand-off carries all travellers) |
| `bookingMethod` | Travel Request |
| `bookingDeadline` | Travel Request |
| `approvedCostCeilingSgd` | Travel Request (airfare + accommodation ceiling) |
| `approvedExceptions[]` | Policy / approval record |
| `segments[]` (AIR/HOTEL) | Approved itinerary + accommodation, with approved class and capped nightly rate |

## Inbound (TMC → ECS)

Simulated by the mock adapter. Canonical fields:

| Field | ECS target |
|---|---|
| `pnr`, `ticketNumbers[]` | TravelBooking |
| `bookingStatus`, `channel` | TravelBooking |
| `fareSgd`, `taxesSgd`, `feesSgd` | TravelBooking (cost comparison) |
| `segments[]` (booked class, dates, room rate) | BookingSegment (class / accommodation deviation checks) |

## Reconciliation (§6.4)

On inbound, booked values are compared with approved values using the seeded tolerances
(`src/data/tolerances.ts`): fare deviation of +10% or +SGD 200 (whichever lower) raises a
**material** `BookingDeviation` routed for reapproval (AC10). Minor timing changes within
tolerance are logged only.

## Future TMC transition (§7.5)

Appointing a new TMC still requires provider mapping, interface configuration/development,
testing and cutover — but the change is limited mainly to the **TMC adapter, code
mappings and interface testing**, not a rebuild of the pre-trip module or the end-to-end
approval and claim process. The interface contract and a test pack should be included in
future TMC tenders.

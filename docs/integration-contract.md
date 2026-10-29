# ECS ⇄ TMC Canonical Integration Contract (§7.3–7.5, §13.9)

The prototype demonstrates TMC integration with **static mock payloads only** — no live
connectivity. The value of the design is that ECS publishes **one provider-neutral
canonical contract**; all provider-specific mapping lives in an adapter layer
(`src/integrations/tmc/adapter.ts`), so a future TMC change is contained to that layer
while the pre-trip process, approval workflow, policy rules, canonical model and TE
linkage stay unchanged (§7.5).

Contract types: `src/integrations/tmc/contract.ts`; the declarative, admin-editable datapoint
catalogue (what is sent / synced, with include-exclude toggles) is `src/config/integrationContracts.ts`
(version `ecs-pretrip-contract/1.2`). Payloads are generated on approval and rendered on the
**Integration Contracts** screen (TR-20) — the inbound feed is shown both as a finance-readable
table (datapoint → value) and as the raw JSON wire payload — and on the Booking Details screen (TR-14).

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

Simulated by the mock adapter; the feed is **keyed by the Travel Authorisation (TA)**, not the
PNR — one TA returns the full set of PNRs under it (one TR → N PNRs). The datapoints synced back:

> **Group bookings (§13.14).** A group is **one TR and one TA**, shared by every traveller — the TA
> number is never split. Each traveller is a stable, frozen **line** on that TA (`TA-…/0n`, assigned
> at submission, never renumbered or reused on amendment; lead = `/01`) and is fanned out as its own
> booking instruction (`instructionSeq` = the line number) that returns its **own PNR + e-tickets**.
> So the per-traveller distinguisher downstream is the PNR (system key) and the `/0n` line (finance
> reference) — not a change to the TA. Stored on `TravelRequestTraveller.lineNo` and
> `TravelBooking.travellerLineNo`; shown on the Booking Details group view.

### Booking confirmation (§30/§39 lifecycle · DD-17)

| Datapoint | ECS target / use |
|---|---|
| `authorisationNumber` | the TA the feed is keyed by (one TA → N PNRs); the association anchor |
| `pnr` + `supplierCode` | the PNR **key** is `(supplierCode, pnr)` — a record locator is unique only within its owning GDS/supplier |
| `ticketNumbers[]` | TravelBooking — e-tickets |
| `invoiceNumber` | provider invoice no. = SAP posting Reference (PNR used when absent) |
| `bookingStatus` | §7.3 **OBT / TMC industry status** (`IN_PROGRESS`…`TICKETED`…`CANCELLED`, see vocab below) — ECS maps it onto its own lifecycle via `obtToEcsBookingStatus()` (`src/integrations/tmc/vocab.ts`) |
| `channel` | fulfilment channel (online / agent-assisted / offline) |
| `bookedAt`, `ticketedAt` | confirmation / ticket-issue timestamps (a charge posts only once ticketed) |
| `segments[].bookedClass` | booked cabin — class deviation vs approved (§6.4) |
| `segments[].segmentRef / pnr` | §7.3 association keys — segment → PNR → TA trace (persisted on BookingSegment) |
| `segments[].segmentStatus` | air: GDS segment status code (HK confirmed / UN cancelled / TK sched-change …) |
| `segments[].ticketNumber / couponNumber` | air: the e-ticket + coupon covering this segment |
| `segments[].departDate / arriveDate` | booked travel dates (DD-17), persisted on BookingSegment |
| `segments[].supplierName / supplierCode / confirmationNo` | airline / hotel (+ hotel conf. no.) for reconciliation |
| `fareSgd`, `taxesSgd`, `feesSgd` | estimate-to-actual comparison |

**OBT booking-record status (Part A), mapped to ECS:** `IN_PROGRESS`/`QUEUED` → In Progress · `TRAVELLER_ACTION_REQUIRED` → Traveller Action Required · `PARTIALLY_TICKETED`/`WAITLISTED` → Partially Booked · `HELD`/`CONFIRMED`/`TICKETED`/`SCHEDULE_CHANGE`/`REISSUED` → Booked · `CANCELLED`/`VOIDED`/`REFUNDED`/`EXPIRED` → Cancelled · `REJECTED`/`FAILED` → Failed · `NO_SHOW`/`COMPLETED` → Travel Completed. GDS segment codes (Part B: HK/HL/UN/TK…) and e-ticket coupon codes (Part C: O/F/R/V…) are carried verbatim on segments.

**Charge → fulfilment trace:** each `charges[]` line carries `pnr` and, for air, `ticketNumber` (+ `segmentRef`), so finance can walk a charge → e-ticket/segment → PNR → TA.

### CTA charges — the SAP posting (DD-30 / DD-31)

The authoritative per-charge basis ECS posts to SAP on receipt (Dr expense ⇄ Cr CTA clearing):

| Datapoint | ECS target / use |
|---|---|
| `ctaAccountId`, `ctaCardRef` | CTA card the central charges hit → credit (clearing) GL via the CTA master; masked card ref for statement reconciliation |
| `ctaCharged`, `ctaChargeDate`, `statementPeriod` | a charge posts only once settled on the CTA; billing period reconciles to the card statement |
| `charges[]` — `type` · `expenseTypeId` · `amountSgd` | one Dr posting line per charge; the expense-type master gives the GL (the agency fee is its own line, never folded into the zero-rated airfare) |
| `charges[].gstCode` · `gstAmountSgd` · `gstClaimable` | SAP tax code (IZ / IO / I9 / P9) + external tax amount; the I9 ↔ P9 fork follows the charging-account GST-claimable flag |
| `charges[].currency / foreignAmount / fxRate` | audit for a foreign-currency booking (ECS posts the SGD amount) |

### Cancellation, refund & change

| Datapoint | ECS target / use |
|---|---|
| `cancellation.cancelledAt / reason` | booking cancelled |
| `cancellation.cancellationFeeSgd` | non-refundable penalty — **stays a charge** |
| `cancellation.refundSgd` | amount refunded to the CTA — **reverses** the posting (partial reversal: the charge's net = the penalty) |
| `reissue.reissuedAt / changeFeeSgd / newPnr / newTicketNumbers` | booking amended — change fee + new reference, reconciled vs the approved request (§6.4) |

## Reconciliation (§6.4)

On inbound, booked values are compared with approved values using the seeded tolerances
(`src/data/tolerances.ts`): fare deviation of +10% or +SGD 200 (whichever lower) raises a
**material** `BookingDeviation` routed for reapproval (AC10); a booked class above the approved
class is likewise a deviation. Minor timing changes within tolerance are logged only.

On a **cancellation**, the CTA posting is reversed using the feed's split: the `refundSgd` reverses
(a partial reversal) while the `cancellationFeeSgd` **stays posted**, so the charge's net = the
retained penalty (the real NTU cost) rather than zero.

## Future TMC transition (§7.5)

Appointing a new TMC still requires provider mapping, interface configuration/development,
testing and cutover — but the change is limited mainly to the **TMC adapter, code
mappings and interface testing**, not a rebuild of the pre-trip module or the end-to-end
approval and claim process. The interface contract and a test pack should be included in
future TMC tenders.

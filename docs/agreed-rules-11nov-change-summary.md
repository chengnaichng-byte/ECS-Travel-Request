# Agreed business rules of 11 November 2026: change summary by rule ID

For updating the "Travel Request: Validation & Business Rules" document (which was
deliberately NOT regenerated). One row per rule: what changed in the code, the file and
function names for the Technical Reference line, and any assumption made.

Tests: `npx tsx tests/contract-v13.test.mts` -> **116 passed, 0 failed**. Typecheck
(`npx tsc --noEmit`) clean. Production build (`npx next build`) compiles clean.

No em dashes anywhere. Contract version held at `ecs-pretrip-contract/1.3`.

---

## CRT-1, CRT-2 (who can raise a request): NOT BUILT (by instruction)

Per your instruction ("Do not need to build CRT-1 and CRT-2 in the prototype. Implement
the rest."), the originator list in `creatableTravellerIds` / `canCreateFor` was left
unchanged. No code, test or document change for CRT-1 / CRT-2. The rest of the brief is
implemented below.

## RTE-9 (research = largest charging share)

- **Rule now:** a TR is research when the charging account carrying the LARGEST effective
  share is a research account (`isResearch`). Tie for the largest share: the primary
  account (`isMain`) decides. Before any allocation exists: the traveller's default
  charging account decides.
- **Code:** new leaf classifier `isResearchByCharging(allocations, travellerId)` in
  `src/modules/pretrip/research.ts` (`accountIsResearch` via `EcsCharging.code(...).isResearch`;
  default-account fallback via `EcsIdentity.employee(travellerId).defaultChargingCode`).
  `isResearchRequest(req)` in `src/modules/pretrip/route.ts` now delegates to it (dropped the
  old "any allocation is research, or `req.isResearch`").
- **Assumption:** "share" is the per-account `percent` of the effective split (CHG-2),
  independent of entry mode (MAIN / CLAIM / ITEM), which the prototype already normalises to
  percent at save.

## NTR-1 (non-term research lane uses the same classification)

- **Rule now:** the non-term research lane keys off the same largest-share classification,
  not "any research allocation".
- **Code:** `nonTermResearchEligible` in `src/modules/pretrip/nonTerm.ts` delegates to
  `isResearchByCharging` (param widened to include `percent` / `isMain`). Routing (RTE-9),
  non-term lane (NTR-1), PI self-approval (PSA) and DOA candidates (RTE-4) all read the one
  classifier, so they cannot disagree.

## CHG-5 (each line keeps its own isResearch; only TR-level changes)

- **Rule now:** every charging line keeps its own `isResearch` flag; only the TR-level
  classification is derived from the largest share.
- **Code:** no change to per-line `isResearch` (unchanged on `ChargingAllocation`). Only the
  TR-level reducer moved, in `research.ts` / `route.ts` above. Per-line flags still drive the
  line-level display and the split.

## CHG-10 (re-evaluate on charging change before approval; reset DOA; notify)

- **Rule now:** classification is first set from the traveller's default account; a charging
  change before approval (including cross-charging) re-evaluates it. On a flip: re-derive the
  route (Research DOA vs normal DOA line, RO skip, subject to `sameRouteResearch`), clear a DOA
  selected from the previous line, re-check PI self-approval, keep the NTR-3 standing-declaration
  block, and show the requestor the category changed. After approval the TR is locked (PAL-1).
- **Code:** `saveCharging` in `src/modules/pretrip/actions.ts` computes `oldResearch` /
  `newResearch` (old `ChargingAllocation` rows vs the incoming `raw.rows` via
  `isResearchByCharging`); on a flip it sets `selectedDoaId: null`, writes a one-shot
  `researchChangeNote`, and audits. Submission (`submitRequest`) clears `researchChangeNote`
  (the route is rebuilt by the existing routing). The notice renders as an amber callout on
  the charging page, `src/app/requests/[id]/charging/page.tsx`.
- **Schema:** `TravelRequest.researchChangeNote String?` (one-shot notice; null = none).
- **Assumption:** the notice is a transient, requestor-facing prompt, not a standing audit
  field; the durable record of the change is the `AuditEvent` row written alongside it.

## GRP-6 (one TA for the whole group): CONFIRMED (held by test)

- **Rule:** one TA at approval; every per-traveller instruction and returned PNR carries it;
  a traveller is identified by TA + `instructionSeq`.
- **Code:** already true. `outboundFromSnapshot` in `src/modules/pretrip/tmcPayload.ts` puts
  `authorisationNumber` once on the `GROUP_FANOUT` envelope (not per instruction). Locked in
  with contract tests (GRP-6 x3): shared authorisation number, no per-member TA,
  `instructionCount === 3` for a group of three.

## GRP-7 (each traveller claims only for themselves; deviations trace to the traveller)

- **Rule now:** only the traveller, or their delegate on their behalf, can raise that
  traveller's claim; a delegate claim is recorded as the traveller's. The requestor cannot
  claim for other members unless a delegate. Netting (CLM-8) is per traveller. Deviations on a
  traveller's PNRs belong to that traveller; the offline-evidence requirement is on that
  traveller's claim.
- **Code:**
  - Claimant resolution: pure `resolveClaimTraveller(members, persona, delegablePrincipals)` in
    `src/modules/te/claimRemit.ts`. `createClaimFromRequest` in `src/modules/te/actions.ts`
    calls it (delegable principals from `EcsDelegation.canCreateTravelRequestFor(persona)`),
    blocks with an audit + `?claimBlocked=1` when it returns null, and records on-behalf.
  - Per-traveller netting was already in place: prior-claim netting is scoped
    `where: { requestId, travellerId: claimantId }`, and `prepopulateClaim(req, claimantId, ...)`
    builds that traveller's share (CLM-7). Confirmed, not changed.
  - Evidence gate scoped: `submitClaim` filters deviations with
    `forClaimant(d) = d.travellerId == null || d.travellerId === claim.claimantId`.
  - Traceability: `receiveBooking` builds a PNR -> traveller map and stamps
    `travellerId` / `travellerLineNo` on each `BookingDeviation` (PNR's booking traveller;
    sole traveller for a non-group request; null for a group aggregate).
- **Schema:** `BookingDeviation.travellerId String?`, `BookingDeviation.travellerLineNo Int?`.
- **Reused:** `EcsDelegation.canCreateTravelRequestFor` (the existing delegation data), as agreed.

## GRP-8 (remove a member before approval via recall)

- **Rule now:** before approval, remove a member by recalling to Draft, removing the member and
  resubmitting (goes through approval again). GRP-1 still blocks dropping below two members; a
  group of two is cancelled and the remaining traveller raises a new individual request. Recall
  must be available while the request is still in approval, not only once Approved.
- **Code:** `recallEligible(status, bookingStatus, recallableBooking)` in
  `src/modules/pretrip/booking.ts` returns true for `Pending*` (in approval) as well as
  `Approved` + a recallable booking status. `recallRequest` in
  `src/modules/pretrip/actions.ts` uses it, skips the pending approval steps when in approval,
  and audits. A "Recall to Draft" action shows on the request details page when
  `canEditRequest(persona, req) && req.status.startsWith('Pending')`.
- **Assumption:** the sub-two-member block (GRP-1) and the group-of-two cancellation remain the
  existing member-management behaviour; GRP-8 only added the in-approval recall entry point.

## GRP-9 (cancel a member after approval, before sending to the TMC)

- **Rule now:** a single member can be cancelled in the module only while the instructions have
  not been sent. The request is not recalled or re-approved: the member is marked **Cancelled**
  and their instruction is not sent; the others go under the same TA. No new outbound message;
  the fan-out omits the member, `instructionCount` drops, `instructionSeq` stays stable for the
  rest. After sending, a single member cannot be cancelled in the module.
- **Code:** `cancelGroupMember(id, travellerRowId)` in `src/modules/pretrip/actions.ts` marks a
  member Cancelled only when `Approved && bookingStatus === NotSent`, and refuses once it would
  leave fewer than one active member. `outboundFromSnapshot` (tmcPayload.ts) takes
  `cancelledRefs`, drops those instructions, and reports `instructionCount` as the number
  remaining (others keep their frozen `instructionSeq`). `handoffToTmc` passes the cancelled
  refs. The group travellers table (`src/app/requests/[id]/booking/page.tsx`) shows a Cancelled
  pill and a "Cancel member" action only before send.
- **Schema:** `TravelRequestTraveller.status String @default("Active")` (Active | Cancelled).

## GRP-10 (after booking: single-member refund synced from the TMC feed)

- **Rule now:** the cancellation is made with the TMC for that traveller's PNRs only; the module
  does not send a single-member cancellation. The inbound feed returns the cancellation, fee and
  refund; sync the refund to that traveller, reverse their CTA charges for the refund, keep the
  non-refundable penalty as a charge (`retainedSgd`, PAL-4). The request and TA stay for the
  others.
- **Code:** `receiveMemberCancellation(id, travellerRowId, fd)` in
  `src/modules/pretrip/actions.ts` marks the member's booking + record Cancelled and calls
  `reverseCtaChargesForBooking(booking.id, { penaltySgd })`. Settlement is the pure
  `settleCancellation(bookedSgd, ticketed, penaltySgd = 75)` in
  `src/modules/pretrip/ctaPosting.ts`: ticketed keeps the penalty and refunds the balance
  (never negative); un-ticketed voids at no cost. The request stays Booked with its TA. A
  "Sync TMC cancellation" action shows after booking.
- **Assumption:** the default non-refundable penalty is SGD 75 (the prototype's existing
  cancellation penalty), overridable per call.

## GRP-11 (every traveller in a group can see the request)

- **Rule now:** each traveller in a group request can see it in their own list; seeing is not
  editing (edit rights stay with CRT-3).
- **Code:** `isRequestVisibleTo(req, persona)` in `src/modules/pretrip/scope.ts` (requestor OR
  individual traveller OR group member). Used by both the Travel Request Dashboard
  (`src/app/dashboard/page.tsx`) and the home status band (`src/app/page.tsx`) so both scope the
  same way. No edit right is granted.

## CRT-3, PAL-2: UNCHANGED (open NTU decisions)

No change to who can edit or submit a draft (CRT-3) or to post-approval material-amendment
re-approval (PAL-2).

## Documents

- **Data Dictionary** (`docs/NTU-Travel-Request-Data-Dictionary.docx`, via
  `docs/generators/gen_datadict.js`): added `TravelRequest.researchChangeNote` (CHG-10),
  `TravelRequestTraveller.status` (GRP-9), `BookingDeviation.travellerId` /
  `travellerLineNo` (GRP-7).
- **Integration Contract** (`docs/NTU-Travel-Request-Integration-Contract.docx`, via
  `docs/generators/gen_integration.js`): 4.3 one shared TA (GRP-6) and member omission before
  send (GRP-9); 5.5 deviation record carries `travellerId` / `travellerLineNo` (GRP-7); 7
  single-member cancellation after booking (GRP-10); Section 11 change-log rows appended
  (GRP-6, GRP-7, GRP-9, GRP-10, CHG-10). Previously agreed wording unchanged; contract stays at
  `ecs-pretrip-contract/1.3`.
- **Validation & Business Rules** document: intentionally NOT regenerated.

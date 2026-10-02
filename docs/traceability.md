# Traceability — Screens & Acceptance Criteria

## Screen inventory (§4)

| ID | Screen | Route | Status |
|----|--------|-------|--------|
| TR-01 | Travel Request Dashboard | `/dashboard` | Built |
| TR-02 | Create Travel Request | `/requests/new` | Built |
| TR-03 | Traveller & Approvers | `/requests/[id]` (overview) | Built |
| TR-04 | Trip Details | `/requests/[id]/trip` | Built |
| TR-05–08 | Estimated Expenses (airfare, accommodation, ODA) | `/requests/[id]/estimates` | Built |
| TR-09 | Charging & Allocation | `/requests/[id]/charging` | Built |
| TR-10 | Policy Review | `/requests/[id]/policy` | Built |
| TR-11 | Review & Submit | `/requests/[id]/review` | Built |
| TR-12 | Approver Review | `/requests/[id]/approve` | Built |
| TR-13 | Approved Travel Request | `/requests/[id]` (overview) | Built |
| TR-14 | Booking Details | `/requests/[id]/booking` | Built (mock) |
| TR-15 | Booking Reconciliation | `/requests/[id]/booking` (deviation panel) | Built (mock) |
| TR-16 | Create TE | `/claims/[id]` | Built |
| TR-17 | Estimate-to-Actual Comparison | `/claims/[id]` | Built |
| TR-18 | Travel Administration Workbench | `/workbench` | Built |
| TR-19 | Pre-Trip Configuration | `/settings` + `/config-viewer` | Built |
| TR-20 | Integration Contracts (TMC / TE sync) | `/integration` | Built |

## §13.19–§13.22 addendum features

- **§13.19 Travel Class register & pre-fill** — effective-dated register (`src/data/travelClassRegister.ts`, Figure D5), entitlement derived per flight leg by duration, pre-filled per traveller with the derivation basis shown; upgrades require justification and route through exception approval.
- **§13.20 Multi-leg itinerary** — `ItineraryLeg` extended (mode, duration, personal-leg, per-leg class); leg editor with add/reorder/remove, date-continuity validation, main-destination-by-longest-stay, per-city accommodation and per-country ODA; compact leg timeline.
- **§13.21 Workflow visualisation & comments** — shared chevron progress bar (Submitted → group Traveller-Confirmation → approval steps, with terminal states) and a comments/attachments panel with header actions (Download PDF stub, Recall, Copy to new request, Close), on both the request detail and approver views.
- **§13.22 ECS visual theme** — palette sampled from the appendix screenshots (red `#D71440`, navy `#1B1C62`, chevron mint/amber/grey); white header with NTU mark + red title, navy section bands, red active nav, green status chips. Tokens in `src/app/globals.css`.

## Approver review/approve page (OpenAI design)

The request detail page (`/requests/[id]`) is the single review + approve screen, variant-aware across individual / multi-leg / group:
- **Header** (request number + `GROUP` pill) and a **status/decision bar** — approval + booking status, exception summary, and inline **Approve / Send Back / Reject** (`DecisionBar`, with a reason prompt) shown when the acting persona is the pending approver; `/requests/[id]/approve` now redirects here.
- **Summary card** (variant-aware: single destination, multi-leg `A → B → C` with "N legs · M countries", or group with coordinator + traveller count) and a **"N days to book"** chip.
- **Lettered A–F cards** (consistent lettering): A Traveller / Group Summary · B Funding+Charging / Itinerary legs / Traveller Roster · C Funding & Approval Basis (with cross-charge note) · D Estimated Cost Summary (approval-amount **basis label** visible) · E **Policy Exceptions with severity + estimated SGD impact** (`exceptions.ts`) · F Estimated Cost Items (aggregated, group lines annotated "N Travellers with Exception").
- Chevron workflow, comments/attachments, and the group management workbench (confirmations, per-traveller class & sub-itineraries) retained below.
- New computed fields: **exception $ impact** (class upgrade = airfare × (1 − entitledIndex/chosenIndex); hotel cap = cap variance) and **severity**; verified live (Business-over-Economy → impact ≈ $2,073, Medium).
- **Restructure (feedback round):** Estimated Cost Summary merged into the Cost Items section; Funding moved below as **Cost Allocation**; header actions (Download PDF, Recall, Copy to new request, Close, Add additional approver) consolidated into a **More Actions** dropdown next to Reject; **Primary Charging Account** surfaced in the banner; **cost-item rows expand** to show the computation (cap, nights, rate, eligible days, variance); Section A a compact 2-column layout; group management workbench **collapsible**; dynamic section lettering.

**TR-18 Travel Administration Workbench** (`/workbench`) — buckets for approved-unbooked (send-to-TMC / self-booked), booking issues & deviations, group requests awaiting confirmation (admin override with reason), amendments in progress, completed-unclaimed (close as no-claim), and expiring/expired authorisations (expiry sweep + reinstate). Admin actions in `src/modules/pretrip/admin.ts`; a **Travel Administration** nav item.

**TR-20 Integration Contracts** (`/integration`) — the admin-editable definition of the two integration boundaries: what is **sent to the TMC** (outbound booking instruction, §13.9) and how each field is **synced to the expense claim** (TE pre-population, §13.8). The declarative registry `src/config/integrationContracts.ts` (`CONTRACT_FIELDS`) is the single source of truth (OutSystems exposed-REST structure + site properties); admin overrides persist in the `IntegrationFieldSetting` entity and merge at read via `src/modules/pretrip/integration.ts` (`getContractSettings` / `tmcEnabledSet` / `prepopContract`). **The flags drive real behaviour**: `buildOutbound` includes a field only when its key is enabled (core fields always sent), and `prepopulateClaim` applies the per-field/-line treatment (Locked/Editable/Reference/Excluded, Excluded drops it) and the booked-amount gate. A **live preview** renders the governed TMC JSON and the claim pre-population for a chosen approved request. Save action `saveContractSettings` (admin-gated); shared assembler `src/modules/pretrip/tmcPayload.ts`. Verified live: turning **hotel segments off** removed HOTEL from the outbound payload (AIR-only) and setting the **ODA line to Excluded** dropped the ODA line from the claim, while genuine accommodation lines remained.

**Parameter filters (message guards).** Beyond per-field inclusion, the contract carries **message-level gates** (`CONTRACT_GUARDS`) deciding *when* a message fires, on **all three boundaries** — TMC outbound (send), TMC inbound (receive) and **ECS expense-claim sync** (`TE_SYNC`, create claim from request). A message fires only when **all** enabled conditions for its flow hold. Each guard is a declarative predicate (`param · op · value`, ops `eq | in | isSet`); admins toggle each and **edit its value**: `eq` guards via a value dropdown (options per parameter, `GUARD_PARAM_OPTIONS`), the `in` guard (booking method) via a multi-select of checkboxes (persisted as a JSON array), and `isSet` guards carry no value (toggle only). Defaults — outbound: status = Approved, booking status = Not Sent, booking method ∈ TMC-served set, TA issued; inbound: booking status = Sent to TMC, TA issued; **ECS/TE sync: status ∈ {Approved, Closed}, TA issued**. Resolved/evaluated in `integration.ts` (`getGuardSettings` / `evaluateFlow`), persisted in `IntegrationGuardSetting`, saved via `saveContractGuards`, and **enforced** in `handoffToTmc` (OUTBOUND), `receiveBooking` (INBOUND) and `createClaimFromRequest` (TE_SYNC) — a blocked attempt is audited, not performed. The page shows per-request **eligibility** (each condition ✓/✕ with the actual value).

**Provenance header.** Each canonical message carries a `meta` header alongside the body (not the filter rules — a factual snapshot for correlation & audit): outbound `{ messageId, sentAt, sourceStatus, contractVersion }`; inbound `{ messageId, receivedAt, correlationId (= the outbound messageId), sourceStatus, contractVersion }`. `messageId` is an idempotency key; `sourceStatus` snapshots the request status at emission; `contractVersion` (`CONTRACT_VERSION`) ties the message to the contract shape. Stamped in `handoffToTmc` / `receiveBooking` with a real UUID + timestamp; the `/integration` preview uses a deterministic `preview-<reqNo>` id. Verified live: an inbound response's `correlationId` matched the outbound `messageId`. Verified live: an Approved-unbooked request is *Eligible to send*; a *Pending RO Approval* request is *Blocked* on "status = Approved"; and tightening the status guard to `Closed` then attempting a hand-off left booking status **Not Sent** with the block logged in the audit trail.

## Persona switcher — role + person (ECS role model)

The "Acting as" control is split into **two linked dropdowns**: the first selects the **ECS role**, the second the **person** assigned that role (filtered to the chosen role). Roles reuse the ECS model and extend it for the pre-trip module (`src/data/personaRoles.ts`, `PERSONA_ROLES`), grouped by **stage** (optgroups) so it is clear which roles act on the travel request versus the claim:
- **Travel request — raise & approve:** Requestor (traveller; becomes the Claimant at claim stage), PA / Group Requestor (raises group requests, not a traveller), Delegate (raises requests & claims on behalf of a traveller — same ECS delegation), RO, Additional Approver, DOA (incl. Research DOA), Exception Approver.
- **Expense claim (after conversion):** Claimant, Verifier — the **Verifier is an ECS claim-stage role and is not configured to approve travel requests**.
- **Administration:** Travel Administrator.

Assignments are derived from the ECS employee roles + delegation register (`peopleForRole`), not hard-coded name lists. Selection persists to the `ecs_persona` + `ecs_role` cookies (`setPersona`); the person's home role is the default (`defaultRoleFor`).

The **Workflow** panel is labelled **Workflow · Research** (a pill) when the request is research-charged (`isResearchRequest`, via research WBS or research purpose), so the research route (→ Research DOA) is visually distinct from the standard route.

## Review-usability refinements (post-v9 feedback)

- **Charging & Cost Objects card** (`ChargingBreakdown`) on the request overview and the approver screen — shows each CC/WBS with Charging Account, Company/Business Area, department, **Research WBS badge + funding owner**, share % and **SGD amount per cost object**, so an approver sees exactly what lands on a department CC vs a research WBS.
- **Full-width, responsive layout** — list/detail pages use the full screen width (like ECS); grids stack at tablet/mobile, tables scroll, the header shrinks on small screens. No horizontal overflow at 375 / 820 / 1440.
- **Per-traveller group class & itinerary overrides** — each group traveller has an individually-derived entitlement; a per-traveller class + justification (policy evaluates justification per traveller) in the Group Travellers panel.
- **Full per-traveller sub-itineraries (§13.20)** — `ItineraryLeg.travellerId` (null = shared group leg; set = that traveller's own legs). A traveller can *Create own itinerary* (seeded from the group), add/reorder/remove their own legs, or *Revert to group*. Their **effective itinerary** = own legs if any, else the shared legs; from it the system derives their **own dates, per-leg + overall entitled class, their attributed ODA, and their share of the shared accommodation** — all following their own dates — while the group itinerary and other travellers are unaffected. **Accommodation is date-aware**: each traveller's room cost = nightly rate × their own nights at that city, and the shared hotel total is the sum (so extending a stay genuinely increases the cost, not just redistributes it). Verified live: Dr Henry Ong's later return (11-16 vs group 11-13) moved his ODA 5→8 eligible days ($480→$840) and his accommodation $1,320→$2,310 (7 nights), lifting his share to $4,400 (42%) and the group gross $9,150→$10,500. A per-traveller sub-itinerary change after approval triggers **reapproval only when material** (§6.4): date shift > 2 days, cost up > +10%/SGD 500, or a class increase → status Amendment In Progress and the route restarts; smaller changes are logged as non-material (`reapproveIfMaterial` in actions.ts). Verified both paths live.

## Acceptance criteria (§8.2, §13.10, §13.15, §13.17)

| AC | Feature | Where |
|----|---------|-------|
| AC01 | Create request with ECS-derived profile | `createDraft` + TR-03 |
| AC02 | Reuse ECS configuration (no second master list) | `src/shared/ecs/services.ts`, Config Viewer |
| AC03 | Approval route changes with settings | Module Settings + `route.ts` |
| AC04 | Hotel cap variance & exception outcome | `pricing.computeAccommodation` |
| AC05 | ODA from configured rates & eligible dates | `pricing.computeOda` |
| AC06 | Submission blocked unless allocations = 100% | `policy.ts` ALLOC hard stop |
| AC07 | Unique TA number only on final approval | `numbering.nextAuthorisationNumber` |
| AC08 | Provider-neutral outbound payload | `integrations/tmc/adapter.buildOutbound` |
| AC09 | Mock inbound updates PNR/fare/status | `adapter.simulateInbound` + `receiveBooking` |
| AC10 | Booking deviation identified & routed | `receiveBooking` deviation check |
| AC11 | Create draft TE from approved request | `te/actions.createClaimFromRequest` |
| AC12 | Estimate-to-actual shows approved/actual/variance | TR-17 |
| AC13 | Audit history retained | `AuditEvent` throughout |
| AC14 | Access by role/persona | Persona switcher + approver guards |
| AC15 | TE pre-population treatments | `te/prepopulate.ts` |
| AC16 | Mandatory linkage enforced | `teLinkageMandatory` setting |
| AC17 | Multiple claims cumulative vs approved | `TravelExpenseLink` (one-to-many) |
| AC18 | Personal days/nights excluded | `computeOda` / `computeAccommodation` |
| AC19 | Material amendment → reapproval (new version, TA retained) | `amend.applyMaterialAmendment` + `finalizeApproval` |
| AC20 | Withdrawal / send-back | `withdrawRequest` / `sendBack` |
| AC21 | Expiry of approved-unbooked | status model (Expired) |
| AC22 | Self-approval prevention | `route.pickRo` / `route.pickDoa` |
| AC23 | Currency conversion drives DOA tiering | `EcsFx` + `computeSummary` |
| AC24 | Only valid status transitions offered | `enums.STATUS_TRANSITIONS` |
| AC25 | RO/DOA dashboard tabs | `/approvals` (Travel Requests tab) |
| AC26 | Delegated individual request | `createDraft` + delegation (`EcsDelegation`) |
| AC27 | Group request creation + confirmations | `createGroupDraft`, `confirmInclusion`, PendingConfirmation gate |
| AC28 | Highest-charging-department routing | `route.highestChargingDept` |
| AC29 | Per-traveller policy checks | `policy.ts` (per-traveller class check) |
| AC30 | Per-traveller claim shares | `prepopulate.ts` filters to claimant's lines + equal shared split |
| AC31 | Group closure / per-traveller variance | `TravelExpenseLink` per traveller + estimate-to-actual |
| AC32 | Traveller removal releases share + triggers reapproval | `removeGroupTraveller` → `applyMaterialAmendment` |
| AC33–36 | Self-booked travel & TR selection at claim | `markSelfBooked` + `teLinkageMandatory` |
| AC37 | No editable master screens | Config Viewer read-only, §13.18 |
| AC38 | Class pre-fill from register (or Economy default) | `EcsTravelClassRegister.entitledForItinerary` + trip form |
| AC39 | Class upgrade needs justification + exception route | `policy.ts` CLASS/CLASS_JUSTIFY + `route.ts` (S15) |
| AC40 | Duration-conditioned entitlement per leg (mixed) | per-leg `entitledForDuration`, trip leg table (S14) |
| AC41 | Multi-leg capture, continuity, main-dest by longest stay, per-city accom | `addLeg`/`recomputeItinerary` + trip editor |
| AC42 | Multi-leg ODA per country excl. personal; recalculated at claim | `computeOda` + per-destination lines (S14) |
| AC43 | Workflow chevrons (completed/current/upcoming, terminal states) | `WorkflowChevrons` |
| AC44 | Route reflects config / exception in the diagram | chevrons from persisted `ApprovalStep`s (S15) |
| AC45 | Comments feed (system events + user comments) | `RequestActivity` + `addComment` (verified live) |
| AC46 | Group confirmation chevron with count | `WorkflowChevrons` group branch |
| AC47 | ECS look-and-feel parity | §13.22 theme tokens in `globals.css` |
| AC48 | Enhancements use only ECS palette/vocabulary | stepper, stat tiles, leg timeline, chevrons |

## Reference masters — Travel Purpose (reused from ECS)

The Travel Purpose list is **reused verbatim from the ECS master** (Setup & Maintenance › Travel Purpose): the 9 entries — Official Business (Acad / Admin / Research Staff), Retreats, Student Travel, Training/Conference (Acad / Admin / Research Staff), Visiting Academic Travel — each with its **GL account code**, **allowed expense types** and **Active/Inactive status** (`src/data/travelPurposes.ts`). The pre-trip module adds only extension attributes (research indicator, pre-trip-mandatory, TE-linkage requirement, allowed booking methods). Inactive purposes (Student Travel, Visiting Academic) are hidden from selection on new requests; the Research-Staff purposes drive the Research DOA route. Shown read-only in the Configuration Viewer with GL code, expense types and status. Demo scenarios use `TP-TC-ACAD` (Training/Conference – Acad Staff) and `TP-OB-RES` (Official Business – Research Staff).

**GL account — scope decision.** The purpose's GL account code is retained as an **attribute of the reused ECS master, shown read-only in the Configuration Viewer only**. It is deliberately **not** surfaced in the pre-trip charging screens: the pre-trip module's responsibility is approval + **cost-object (CC/WBS) allocation**; the actual **GL posting to the ERP is handled by ECS at the claim stage**, and the GL is carried by the reused Travel Purpose. (An earlier build that made pre-trip charging "post to GL" was reverted as out-of-scope.)

## Working-prototype hardening (P1)

Server-side enforcement added so the lifecycle no longer trusts the UI (`src/modules/pretrip/guards.ts`):
- **State machine (AC24):** every mutating action (`submitRequest`, `approveStep`, `rejectStep`, `sendBack`, `withdrawRequest`, `reopenDraft`, `cancelRequest`) checks the request is in a valid source state via `actionAllowed(...)` (driven by `ACTION_SOURCE`, aligned with `STATUS_TRANSITIONS`); out-of-state calls are audited and refused.
- **Approver authorization (AC14/AC22):** `rejectStep`/`sendBack` now apply the same `canActOnStep(approverId, persona)` check as `approveStep`, and a step with a **null approver** is no longer actionable by arbitrary personas (closed the self-approval hole); Travel Admin override preserved.
- **Booking negative paths:** `handoffToTmc` is idempotent (won't double-send an in-flight/booked request → no orphan bookings); `receiveBooking` supports a **FAILED** outcome and is idempotent on an already-Booked request; `resendToTmc` retries a failed booking (resets to Not Sent, discards the stale hand-off, re-sends). Booking page gains an outcome selector + Re-send button + failed/cancelled banners.
- **Request cancellation:** `cancelRequest` (Approved / Amendment / Expired → Cancelled, skips pending steps, marks a live booking cancelled) surfaced in the More Actions menu.
- **Claim cumulative & duplicates (AC17):** creating a claim reuses an existing open (Draft) claim instead of duplicating; `prepopulateClaim` nets each line by amounts already claimed in that category (prior submitted claims), so a follow-up claim only covers the remaining balance; a fully-claimed request is refused. Verified live: booking failure→resend→book (no orphan), double "Create TE claim" → 1 claim, submit→re-create → blocked as fully claimed, cancel approved→Cancelled, and the normal approval chain still advances.

## Data-fidelity hardening (P1-data)

- **FX is effective-dated and locked at submission (§13.4).** `fxRates.ts` now holds a monthly table (2026-06…12); `sgdPerUnit(currency, onMonth?)` returns the rate effective on that month (latest ≤ month), and `EcsFx.sgdPerUnit/toSgd` take an optional date. Foreign-currency estimates convert at the **entry-date** rate; `submitRequest` re-locks every foreign line to the **submission-date** rate (`relockFx`) and audits it, so the SGD value is frozen at submission. Verified: GBP 2000 → SGD 3460 at the 2026-10 rate; a corrupted stored value was re-locked to 3460 on re-submit.
- **Numbering year derived from the clock.** `actions.ts` / `te/actions.ts` no longer hard-code `2026` — request/authorisation/claim numbers use `new Date().getFullYear()`. (Demo seed keeps a fixed year for deterministic data.)
- **Single source for travel-class entitlement.** The dead, contradictory `classEntitlement` band table and `individualClassExceptions` list were removed from `travelClass.ts`; entitlement is driven solely by the effective-dated Travel Class Register (`EcsTravelClassRegister`).
- **Policy thresholds moved to config.** `src/config/policyThresholds.ts` holds the short-lead-time, long-trip, high-estimate and exception-severity (High/Medium $) thresholds, consumed by `policy.ts` and `exceptions.ts` instead of inline magic numbers. ODA now reads the configurable travel-day count and **applies `odaFullDayPct`** (`policyRates.ts` + `EcsPolicy.odaTravelDays`).

## Robustness hardening (P2)

- **Server-side create validation (not UI-only).** `saveTrip` rejects a missing purpose / destination / dates / booking method (and a return-before-departure) and redirects back with an error banner; the estimate actions reject a ≤ 0 airfare/other amount, an accommodation with no city / nights ≤ 0 / rate ≤ 0, and an ODA with no country or bad date range (banner on the trip & estimates pages). Verified: a $0 airfare is refused with the banner and no line is persisted.
- **Server-side create authority (§13.13).** `createDraft`/`createGroupDraft` re-check the posted traveller(s) against `canCreateFor` (self / delegated / dept-for-requestor) in `guards.ts` — the dropdown is no longer the only gate.
- **Group floor.** `createGroupDraft` now requires ≥ 2 travellers (consistent with `removeGroupTraveller`).
- **Atomicity (`$transaction`).** The route rebuild + status move in `submitRequest`, and the response + booking + segments + deviation + status in `receiveBooking`, each run in a transaction — no half-built route or booking-with-missing-segments on partial failure.
- **Collision-safe numbering.** `numbering.ts` derives the next suffix from the **highest existing** number for the year's prefix (not a row count), so deleting a record can't cause a `@unique` collision. Verified: with a deleted middle request, the next number skips the gap (→ 000008, not 000007).
- **Optimistic concurrency on decisions.** `approveStep`/`rejectStep`/`sendBack` decide the step via a conditional `updateMany(... status: 'Pending')` and bail if another actor already decided it — no double-advance under concurrent approvers.

## Acceptance-criteria capabilities (P1)

- **Guest / non-employee travel (§8, AC7).** A request can be raised for a guest with no ECS/HR profile: `TravelRequest.travellerType` (EMPLOYEE\|GUEST) + `guestName`/`guestEmail`/`guestOrg`, captured in a third "Guest / non-employee" mode on the create screen (`createGuestDraft`). A guest-aware resolver (`modules/pretrip/traveller.ts`) returns the right identity everywhere — dashboard (Guest pill), detail header ("Guest Travel Request" + GUEST pill), the Traveller card (guest identity, host/requestor, charged-to department, "ECS profile: None"), and the review step. The trip is charged to the **host's department**, routes to that department's DOA (no RO; the synthetic `GUEST` id matches no approver so there is no self-approval edge), and defaults to Economy entitlement. The TMC payload carries `bookingFor: 'GUEST'` and a `guest` identity block (name / email / organisation).
- **Group fan-out (§9.3, AC15).** One group approval produces **one TMC booking instruction per traveller**. `assembleOutboundInstructions` emits a `GROUP_FANOUT` envelope whose `instructions[]` each carry that traveller's effective itinerary (own sub-itinerary or the shared legs), chosen class, date-aware nights and cost share; `handoffToTmc` stores the envelope and `receiveBooking` creates **N per-traveller bookings** (`TravelBooking.travellerId`, unique PNRs). The booking page shows the fan-out count and every traveller's booking. An individual request is unchanged (SINGLE mode, one canonical payload).
- **Cross-business-area concurrence (§18, AC5).** When charging spans more than one BA, `buildRoute` adds a Funding-Owner concurrence step for **each non-primary BA whose cost share exceeds the `crossBaThresholdSgd` ModuleSetting** (default SGD 500) — that BA's funding owner or department DOA — while the primary-BA DOA still owns the request. The threshold is a runtime setting (Module Settings, `number` kind).
- **Duplicate / overlapping-trip check (§25/§40).** `overlappingTripsFor` finds other live (non-rejected/withdrawn/cancelled/draft) requests for the same traveller(s) whose official dates overlap; `persistPolicy` surfaces each as an informational **Warning** (naming the clashing request), so a possible double-booking is flagged without blocking submission.

## Downstream integration & approval evidence (P2)

- **Enriched TMC payload (§29).** The canonical outbound now carries, each behind an admin Integration-Contract toggle: `charging[]` (CC/WBS, business area, company code, primary-share flag), `approvals[]` (role, approver, decided-at), `traveller` (policy group — or GUEST — plus contact) and `personalTravel`. This gives the TMC the cost object it needs for direct airfare posting and full booking context.
- **Direct airfare posting to SAP (§36).** When Airfare treatment = `DIRECT_SAP`, `postAirfareToSap` builds a posting document (`src/integrations/sap/posting.ts`): GL from the airfare expense type, booked fare/taxes/fees split across the trip's cost objects, PNR references. Stored as a `SAP_AIRFARE_POST` message and shown on the booking page. Idempotent.
- **Claim prepopulation completeness (§35).** The confirmed TMC booking reference (PNR/ticket) is carried into the claim header (`teBookingRef`); booked amounts already flow per line. A group fan-out picks the claimant's own booking.
- **Approval Pack (§24).** `/requests/[id]/pack` is a print-optimised one-page summary (traveller, trip, itinerary, costs, charging, approval trail, exceptions); browser Print → Save as PDF. "Download PDF" in More Actions links to it.
- **Field-level audit (§38).** `saveTrip` records each changed header field as `Label: old → new` (`fieldDiffs`), matching ECS audit-log granularity.
- **Dynamic approval preview (§21).** The review step shows the route derived from the request's current charging/cost/exceptions/saved Additional Approver (via `buildRoute`), so it reflects edits; the final route is fixed at submission.
- **Config-driven policy rules (§25/§43).** `src/config/policyRules.ts` catalogues every check (code, name, category, default outcome, effective-from, active, mandatory). The engine and the duplicate check gate discretionary rules on `ruleActive(code, date)`; structural-integrity rules are mandatory. Shown in the Config Viewer.
- **Amendment diff + auto-retransmit (§33).** A material amendment computes a header field-diff vs the last approved snapshot and, when a booking is already in flight/booked, retransmits an updated instruction to the TMC (`TMC_AMEND`).
- **Full TMC status model (§30/§39).** Added Received by TMC / Booking In Progress / Traveller Action Required / Partially Booked / Travel Completed, with a status-advance control on the booking page; the inbound acceptance guard now matches any in-flight status.
- **Cancellation TMC details (§34).** Cancelling a request with a live booking emits a `TMC_CANCEL` message carrying a cancel reference and a mock cancellation fee (charged once ticketed).

## Breadth & polish (P3 — batch 1)

- **Notifications (§37).** `modules/pretrip/notifications.ts` derives an in-app feed and a mock email outbox from the real `AuditEvent` stream (submit/approval/reject/send-back/status/integration/claim events), each deep-linking to its request; surfaced at `/notifications`.
- **Finance Oversight (§41/§4).** Read-only `/finance` dashboard: pending/committed/booked spend stats, the TMC booking pipeline, the cross-charge request list and open-exception count, plus a committed-spend table. A new read-only **Finance Viewer** role (`ROLE.FinanceViewer`, persona E-FIN) is added to the switcher; the dashboard changes nothing.
- **Reference-data depth (§15/§16).** Accommodation caps are now maintained **by country** (A–Z, `hotelCapsByCountry`) with city-specific overrides; `EcsPolicy.hotelCap` resolves city → country → none. The ODA table is broadened. Both appear in the Config Viewer.
- **Rejection Reasons master (§26).** `data/rejectionReasons.ts` (reused ECS list); the reject dialog uses a categorised dropdown plus an optional comment, recorded on the approval step and in the audit trail. Listed in the Config Viewer.
- **Inactive charging-code check (§25).** Charging codes carry `active`/`validTo`; a closed grant (WBS-R300) is seeded; the config-driven `FUNDING_INACTIVE` rule raises a hard stop when an allocation uses a closed account.
- **WBS sub-types (§17, partial).** Charging codes carry a Programme/Project `subType`, shown in the Config Viewer (the amount-split charging option remains open).
- **Real attachment upload (§2).** `Attachment.content`/`contentType` store the uploaded bytes (migration `p3_attachment_content`); `addAttachment` reads the posted file (PDF/PNG/JPEG, ≤ 7 MB), a download route (`/requests/[id]/attachments/[attId]`) serves it, and file names are clickable. Replaces the typed-filename stub.

## Breadth & polish (P3 — batch 2, completes P3)

- **Reporting (§42).** `/reports`: operational (by approval/booking status), financial (committed NTU-funded spend by business area / department / charging code) and compliance (exceptions by type, cross-BA, offline, overlapping-trip, self-booked) views — live aggregation, read-only.
- **Expense GST/tax (§13).** Expense types carry `gstCode`/`taxRatePct` (ZP/OS zero-rated or out-of-scope for overseas travel; SR 9%), reused from ECS and shown in the Config Viewer.
- **Settings breadth (§43).** Self-approval limit, attachment max size (MB, enforced in `addAttachment`), charging entry mode (percent/amount), TMC/SFTP transport config, and editable declaration + COI text — all on `/settings` and persisted in `ModuleSettings`.
- **Charging amount-split (§17).** When the entry mode is AMOUNT, charging is captured as SGD amounts and converted to percentages at save (stored alongside the amount); WBS Programme/Project sub-types are recorded and displayed.
- **Traveller prepopulation (§7).** Every employee is enriched with worker type, email, business area, default charging code and travel-eligibility; shown on the Traveller card, and the default charging code pre-fills a fresh request's allocation.
- **Trip/leg field completeness (§10/§11).** Event start/end dates and an invitation reference on the trip header; per-leg departure time and a "booking required?" flag on the itinerary; surfaced on the trip editor, the review step and the approval pack.
- **Personal travel (§12).** A Personal Travel card shows the extension window and the estimated incremental personal cost (personal nights × nightly rate, excluded from the NTU-funded budget); the declaration carries a configurable COI statement and a personal-travel acknowledgement recorded on submission.

## Design decisions (prototype)

**D1 — Approval route (reshaped 2026-10-02; configurable in production).** Pre-trip does **not** auto-route to the traveller's reporting officer — there is **no RO step**. The base route is:
- **Standard:** Traveller → **DOA**
- **With a traveller-chosen additional approver:** Traveller → **Additional Approver → DOA**
- **Research:** Traveller → **(Research) DOA** — the research grant's Research DOA is the authorising officer, not the departmental RO.

Implemented in `route.ts` (`buildRoute`). The **Additional Approver** is *optional, one max*, and **any person from the AD** (the traveller picks them on the Review step; the picker and the builder both exclude the traveller — §48 self-approval guard). A **policy-exception** approver is inserted before DOA **only when `exceptionApproverRequired` is on** (ModuleSettings / decision catalogue §26); when off, the exception is surfaced to the DOA to decide. A **cross-charge funding owner** step is inserted when applicable. The `sameRouteResearch` site property still routes research the same as non-research. DOA tier derives from the amount band and the highest-charging department's DOA line, with escalation past any holder who is a traveller (self-approval prevention). The former `roRequired` setting was removed. New model artefacts: `REQUEST_STATUS.PendingAdditional`, `APPROVER_ROLE.AdditionalApprover`, `TravelRequest.additionalApproverId`, `ModuleSettings.exceptionApproverRequired` (migration `additional_approver_workflow`).

**D2 — Group travellers confirm inclusion; they do not approve.** A group request is **approved once on the group total** by the DOA route above (DOA derived from the highest-charging department). Individual travellers are **not** approvers. After approvals complete, if any traveller has not yet acknowledged participation the request is held at **Pending Traveller Confirmation**; each traveller (or the Travel Administrator, via override) confirms *inclusion* (`confirmInclusion` sets `confirmed=true`), and once **all** are confirmed the Travel Authorisation is issued (`finalizeApproval`). The acting traveller sees a **"✓ Confirm my inclusion"** button in the request's **top action bar** (shown when the persona is an unconfirmed traveller on the request), as well as in the Group Management panel. So the confirmation is a participation acknowledgement / self-approval-safety gate, **not** a per-traveller approval of the request. `allTravellersConfirmed` / `overrideConfirmations` implement the gate.

**D3 — Per-traveller sub-itineraries within a group are supported but expected to be rare.** The model allows a group traveller to deviate with their own sub-itinerary (own dates/class/ODA/accommodation share, §13.20), which re-derives their attribution and triggers reapproval only when material. In practice most group members travel on the shared itinerary, so this is a **deliberately-retained capability for the uncommon case**, not the default path — the group is created and costed on the shared itinerary and only diverges if someone explicitly *Creates own itinerary*. It is **gated behind the `groupSubItineraries` site property** (Module Settings TR-19, default **on**): when off, the per-traveller *Create own itinerary* editor is hidden and every traveller follows the shared group itinerary (the per-traveller **class** override, a separate §13.19 feature, stays available). `GroupTravellers` receives `allowSub={settings.groupSubItineraries}`.

## Notes on scope

Per §12, the working prototype demonstrates **Create → Approve → Claim** end to end.
TMC hand-off, booking reconciliation and the administration workbench (TR-18) are
mocked, simplified or deferred. **Group travel (§13.13/§13.14) is fully implemented**:
group creation (a PA/requestor names travellers), individual vs shared cost
attribution, single approval on the group total with highest-charging-department DOA,
the per-traveller inclusion-confirmation gate before authorisation (with Travel
Administrator override), per-traveller claim pre-population filtered to each
traveller's own lines and apportioned shares, and **material-amendment reapproval**
when a traveller is added or removed after approval (status *Amendment In Progress*,
route re-derived and restarted, Travel Authorisation retained, a new approved version
created on reapproval). Seed scenarios S11 (group) and S12 (group amendment) exercise
this end to end.

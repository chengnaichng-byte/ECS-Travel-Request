# ECS Pre-Trip Travel Request — Prototype Backlog

Single source for the next build phase. Derived from the OpenAI requirement spec (§ refs
below point to it), the real ECS Maintenance & Setup screens (config masters the module
must reuse), and the three-agent gap review. Effort is relative: **S** ≈ hours, **M** ≈ a
focused build, **L** ≈ multi-part.

---

## 1. Agreed design decisions (baked into this backlog)

### 1.1 Pre-trip approval route (replaces the earlier RO→DOA model)

> **Traveller submits → (optional) Additional Approver → (configurable) Exception Approver → DOA**

- **No RO step.** Pre-trip does not auto-route to the traveller's reporting officer.
- **Additional Approver** — *optional, one max*, **any person from the AD** (the full
  employee directory stands in for AD; not role-filtered). Inserted before DOA.
- **Exception Approver** — inserted **only when a config switch says so** (`exceptionApproverRequired`).
  When off, a policy exception is surfaced to the DOA to decide rather than adding a step.
- **DOA** — authority-derived (charging department + amount band), snapshotted at submission.
- **Self-approval guards** still apply: the traveller cannot pick themselves as the Additional
  Approver, and the existing DOA self-approval escalation remains.

Rationale: §51 leaves pre-trip approval policy unconfirmed and configurable; the ECS
6-tier/11-decision-point workflow is the **claim** engine and is deliberately *not* replicated.
DOA/RO authority is consumed from the (mock) ECS services, never duplicated (§48.5).

### 1.2 Charging goes in the TMC payload (D1 — RESOLVED: include)

Airfare posts **directly to the ERP** (central-billing / CTC model — the flight is billed to a
central travel account and posted straight to the cost object, not reimbursed via the claim).
So the booking/SAP posting needs the charging account. This **reverses** the earlier
data-minimization exclusion. Mechanics: the charging fields (CC/WBS, BA, allocation %, primary)
are added to the Integration Contract outbound flow and switched on. The **GL** for airfare is
derived from the expense type (ET-AIR → GL) at posting; pre-trip still only captures the **cost
object** — no conflict with the earlier GL-UI revert.

### 1.3 Two-path downstream model

| Cost | Path | Needs |
|---|---|---|
| **Airfare** | Pre-trip → TMC → **direct SAP posting** | Charging **in the TMC payload** |
| **Hotel / ODA / other** | Pre-trip → **traveller expense claim** | Pre-trip **prepopulation** (no re-entry) |

Both are confirmed requirements, serving different legs (§35 + §36).

### 1.4 Dropped from the gap list

- ~~Reuse the ECS 6-tier/11-decision-point claim engine~~ — that's the claim workflow; pre-trip is simpler by design.
- ~~Hard-coded route placeholders~~ — folded into P0.

---

## 2. Already built (foundation — do not rebuild)

Create→Approve→Book→Claim end-to-end; individual / group / multi-leg / research vs non-research;
travel purposes reused from ECS (GL, expense types, status); charging CC/WBS with cross-charge +
research-DOA routing; policy engine (pass/warning/exception/hard-stop) with hotel cap, ODA,
travel-class register; exception routing with severity + $ impact; **Integration Contract**
(field-level TMC & TE mapping + message-level parameter filters + provenance envelope — exceeds
spec); amendment with versioning/reapproval; TE claim linkage + estimate-to-actual +
cumulative/duplicate guard; group confirmation gate; Travel Administration workbench; config
viewer + module settings; audit trail + workflow chevrons; FX date-locking; and server-side
hardening (state-machine + authorization guards, atomic writes, collision-safe numbering,
optimistic concurrency, server-side create validation).

---

## 3. Backlog (prioritized)

### P0 — Reshape the approval workflow ✅ **DONE** (2026-10-02) *(foundational; everything downstream snapshots it)*

| ID | Item | Spec | Effort | Status |
|---|---|---|---|---|
| P0.1 | Remove the derived RO step from the pre-trip route | §21, §51 | S | ✅ |
| P0.2 | Additional Approver → **core**: traveller optionally picks one person from AD; inserts a step before DOA (un-stub) | §4, §23 | M | ✅ |
| P0.3 | Configurable exception routing: setting gates "exception → Exception Approver"; off = surface to DOA | §26, §43, §51 | S | ✅ |
| P0.4 | Self-approval guards for the AD-picked approver (no self; DOA escalation retained) | §48 | S | ✅ |

**Delivered & verified live:** route builder emits no RO step; all 7 seeded scenarios route DOA / Exception→DOA / Research DOA. New `PendingAdditional` status + `ADDITIONAL_APPROVER` role + `additionalApproverId` on TravelRequest (migration `additional_approver_workflow`). Review step has an Additional Approver picker (excludes the traveller — self-approval guard; any AD person otherwise). End-to-end tested: submitting with an AA produces route AA→DOA at status *Pending Additional Approval*; the AA can approve and the request advances to *Pending DOA Approval*. `exceptionApproverRequired` is a live-editable ModuleSettings toggle (decision catalogue §26) replacing the removed `roRequired`. Persona switcher extended with the Additional Approver role (grouped by stage).

### P1 — Acceptance-criteria-critical capabilities ✅ **DONE** (2026-10-02)

| ID | Item | Spec / AC | Effort | Status |
|---|---|---|---|---|
| P1.1 | **Guest / non-employee travel** — guest type, identity capture, no ECS profile, "Booking for: Guest", in TMC payload | §8, Sc.6, **AC7** | L | ✅ |
| P1.2 | **Group fan-out → N traveller-level TMC booking instructions** (1 approval → N instructions) | §9.3, Sc.7, **AC15** | M | ✅ |
| P1.3 | **Cross-BA approval path** explicit/config-driven (≤/>$500 threshold, primary-BA DOA) | §18, **AC5** | M | ✅ |
| P1.4 | **Duplicate / overlapping-trip check** (traveller × dates × destination) | §25, §40 | S–M | ✅ |

**Delivered & verified live:**
- **P1.1 Guest travel** — `travellerType` EMPLOYEE\|GUEST + `guestName`/`guestEmail`/`guestOrg` on TravelRequest; a third "Guest / non-employee" mode on the create screen (`createGuestDraft`); a guest-aware resolver (`traveller.ts` — `travellerName`/`travellerTitle`/`travellerEmail`/`isGuestRequest`) threaded through the dashboard, detail header (GUEST pill, "Guest Travel Request"), the Traveller card (identity, host, "ECS profile: None") and the review step. Guest routes to the host-department DOA (no RO, no self-approval issue); default Economy entitlement. TMC payload carries `bookingFor: 'GUEST'` + a `guest` identity block. *Verified: created a guest request for "Prof Maria Santos (MIT)", routed to DOA, payload showed the guest block.*
- **P1.2 Group fan-out** — a group hand-off emits one booking instruction **per traveller** (`assembleOutboundInstructions`): each with that traveller's effective itinerary, class, nights and cost share, under one `GROUP_FANOUT` envelope; `receiveBooking` creates **N per-traveller bookings** (`TravelBooking.travellerId`) with unique PNRs; the booking page shows the fan-out count and all bookings. *Verified: a 3-traveller group → 3 instructions → 3 bookings (PNR…-1/-2/-3).*
- **P1.3 Cross-BA concurrence** — `buildRoute` detects >1 business area; each non-primary BA whose share exceeds `crossBaThresholdSgd` (new ModuleSetting, default SGD 500) adds that BA's DOA/funding-owner as a Funding-Owner concurrence step; the primary-BA DOA still owns the request. *Verified: BA-CS 60% / BA-AI 40% on SGD 2,000 → cross-BA step for E-RDOA ("BA-AI share SGD 800 over SGD 500 threshold") before the primary DOA.*
- **P1.4 Duplicate/overlap check** — `overlappingTripsFor` (queries.ts) finds other live (non-dead, non-draft) requests for the same traveller(s) whose official dates overlap; surfaced as an informational Warning in `persistPolicy`. *Verified: a second Alice Tan trip overlapping TR-06 flagged "Overlapping trip … already on TR-2026-000006".*

Also: removed the now-stale "RO + DOA-n" wording from the workflow band labels; added the `number` kind to the Module Settings screen for the cross-BA threshold; dropped the dead `roRequired` default from the seed.

### P2 — Reuse fidelity, downstream integration & approval evidence

*High-value coherent thread first: carry approved charging + context to TMC, post airfare to SAP, complete claim prepopulation.*

### P2 ✅ **DONE** (2026-10-02) — all ten items implemented and verified live (no migration needed)

| ID | Item | Spec | Effort | Status |
|---|---|---|---|---|
| P2.1 | **TMC payload enrichment** — add charging (CC/WBS/BA/primary), approval metadata (approvers + timestamps), traveller category/contact, personal indicators (per D1) | §29 | S–M | ✅ |
| P2.2 | **SAP airfare posting** — mock interface consuming booked airfare + charging (cost object) + GL-from-expense-type | §36 | M | ✅ |
| P2.3 | **Complete claim prepopulation** — carry TMC booking ref / PNR + confirmed booked costs into the claim | §35 | S | ✅ |
| P2.4 | **Approval Pack / PDF** (summary for email / audit / TMC / claim) — un-stub Download | §24 | M | ✅ |
| P2.5 | **Field-level audit** (previous/new value) matching ECS audit-log granularity | §38 | M | ✅ |
| P2.6 | **Dynamic approval preview** on the create steps (updates as charging/cost/exception/AA change) | §21 | M | ✅ |
| P2.7 | **Config-driven policy rules** (name/category/effective-date/active) replacing hard-coded checks | §25, §43 | L | ✅ |
| P2.8 | **Amendment: field-diff highlight + auto-retransmit** updated instruction to TMC | §33 | M | ✅ |
| P2.9 | **Full TMC status model** — add Received by TMC, Traveller Action Required, Travel Completed | §30, §39 | S–M | ✅ |
| P2.10 | **Cancellation TMC details** — TMC cancel reference + cancellation fee | §34 | S | ✅ |

**Delivered & verified live (headline integration thread first):**
- **P2.1** — the canonical outbound now carries `charging[]` (CC/WBS + BA + company code + primary flag), `approvals[]` (role/approver/decidedAt), `traveller` (policy group or GUEST + contact) and `personalTravel`, each a new admin-editable Integration-Contract toggle. *Verified in the hand-off payload.*
- **P2.2** — `src/integrations/sap/posting.ts` + `postAirfareToSap` action + booking-page button (shown when Airfare treatment = DIRECT_SAP). Posts booked airfare to a GL (from the ET-AIR expense type) split across the trip's cost objects. *Verified: GL-6110, SGD 2,946 across CC-1000, PNR ref.*
- **P2.3** — the confirmed booking reference (PNR/ticket) is carried into the claim header (`teBookingRef` contract field). *Verified: PNR shown on the claim.*
- **P2.4** — printable Approval Pack at `/requests/[id]/pack` (traveller, trip, itinerary, costs, charging, approval trail, exceptions) with a Print→PDF button; "Download PDF" un-stubbed in More Actions.
- **P2.5** — `saveTrip` now writes a field-level audit (`Label: old → new`) via a `fieldDiffs` helper. *Verified: "Travel class: Business → Economy".*
- **P2.6** — the review step renders an "Approval Route Preview" derived from the current charging/cost/exceptions/saved AA (recomputed via `buildRoute`). *Verified: Traveller → Exception Approver → DOA.*
- **P2.7** — `src/config/policyRules.ts` catalogue (code/name/category/outcome/effective-date/active/mandatory); `policy.ts` and the duplicate check gate discretionary rules on `ruleActive`; rules shown in the Config Viewer.
- **P2.8** — material amendments compute a header field-diff vs the last approved snapshot and, when a booking is in flight/booked, retransmit an updated instruction (`TMC_AMEND`). *Verified: class change → reapproval + retransmit audited.* (Fixed a date-formatting bug that produced spurious date diffs.)
- **P2.9** — booking lifecycle statuses Received by TMC / Booking In Progress / Traveller Action Required / Partially Booked / Travel Completed, with a status-advance control; the inbound guard now accepts any in-flight status. *Verified: Sent → Received by TMC → Booked.*
- **P2.10** — cancelling a request with a live booking emits a `TMC_CANCEL` message with a cancel reference and (once ticketed) a mock cancellation fee. *Verified: CXL-PNR0001, SGD 75.*

Also fixed a latent bug: `getGuardSettings` now falls back to the catalogue default when a stored `in`-guard value can't form a usable set (a stale eq→in value was silently blocking inbound acceptance).

### P3 — Breadth, depth & polish ✅ **ALL DONE** (batches 1 & 2, 2026-10-02)

| ID | Item | Spec | Effort | Status |
|---|---|---|---|---|
| P3.1 | **Notifications** (in-app centre + mock email; submit/approval/sent-to-TMC/booking events, deep links) | §37 | M–L | ✅ |
| P3.2 | **Reporting** (operational / financial / compliance) | §42 | L | ✅ |
| P3.3 | **Finance/Admin dashboards** (booking pipeline, $ commitments, cross-charge list, exception list) + Finance/Viewer read-only role | §41, §4 | M | ✅ |
| P3.4 | **Reference-data depth** — accommodation cap by **country** (A–Z), fuller ODA table, per-employee class register | §15/16 | S | ✅ |
| P3.5 | **Expense types carry GST/tax** config (reuse ECS) | §13 | S | ✅ |
| P3.6 | **Rejection Reasons master** (reuse ECS list instead of free text) | §26 | S | ✅ |
| P3.7 | **Settings breadth** (self-approval thresholds, role-based visibility, attachment max, SFTP/transport, declaration/COI text) | §43 | M | ✅ |
| P3.8 | **Inactive WBS/CC validity check** | §25 | S | ✅ |
| P3.9 | **Charging: amount-split option + Programme/Project WBS subtypes** | §17 | S–M | ✅ |
| P3.10 | **Traveller prepopulation completeness** (worker type, email, BA, eligibility, default charging) | §7 | S | ✅ |
| P3.11 | **Trip/leg field completeness** (event dates, invitation ref, per-leg time + "booking required?" flag) | §10/§11 | S | ✅ |
| P3.12 | **Personal travel** (acknowledgement, personal destinations, incremental-cost separation) | §12 | S–M | ✅ |
| P3.13 | **Real attachment upload** (replace typed-filename stub) | §2 | M | ✅ |

**Batch 2 delivered & verified live (2026-10-02; migration `p3b_trip_personal_settings_charging`):**
- **P3.2 Reporting** — `/reports` page: operational (by approval/booking status), financial (committed NTU-funded spend by BA / department / charging code) and compliance (exceptions by type, cross-BA, offline, duplicates, self-booked) views, all live-aggregated. *Verified.*
- **P3.5 GST/tax** — `gstCode`/`taxRatePct` on expense types (ZP/OS/SR), shown in the Config Viewer. *Verified.*
- **P3.7 Settings breadth** — self-approval limit, attachment max (MB, now enforced in `addAttachment`), charging entry mode, TMC/SFTP config, declaration & COI text — all editable on `/settings` and persisted. *Verified: saved, read back.*
- **P3.9 amount-split** — charging can be entered as SGD amounts (mode in settings); `saveCharging` converts to percent; WBS Programme/Project sub-types shown. *Verified: 600/400 → 60%/40%.*
- **P3.10 Traveller completeness** — worker type / email / business area / default charging / eligibility derived onto every employee; shown on the Traveller card; the default charging code pre-fills a fresh request. *Verified.*
- **P3.11 Trip/leg fields** — event start/end dates + invitation reference on the trip; per-leg departure time + "booking required?" flag; shown on the trip editor, review and approval pack. *Verified.*
- **P3.12 Personal travel** — a Personal Travel card shows the extension + estimated incremental personal cost; the declaration adds a configurable COI line and a personal-travel acknowledgement (stored on submit). *Verified.*

**Batch 1 delivered & verified live (2026-10-02):**
- **P3.1 Notifications** — `src/modules/pretrip/notifications.ts` derives an in-app feed + mock email outbox from the real AuditEvent stream; `/notifications` page + nav item. *Verified: 21 feed items / 18 emails incl. "Travel Authorisation issued".*
- **P3.3 Finance Oversight** — read-only `/finance` dashboard (pending/committed/booked stats, TMC pipeline, cross-charge list, committed-spend table) + a new read-only **Finance Viewer** role/persona (E-FIN). *Verified live.*
- **P3.4 Reference-data depth** — accommodation caps now maintained **by country** (A–Z) with city-level overrides (`EcsPolicy.hotelCap` resolves city→country), fuller ODA table; both in the Config Viewer. *Verified.*
- **P3.6 Rejection Reasons master** — `src/data/rejectionReasons.ts`; the reject modal uses a categorised dropdown (+ optional comment) stored on the step; shown in the Config Viewer. *Verified.*
- **P3.8 Inactive WBS/CC check** — `active`/`validTo` on charging codes + a closed grant (WBS-R300) + the `FUNDING_INACTIVE` policy rule (hard stop). *Verified: closed code blocks submission.*
- **P3.9 (partial)** — WBS Programme/Project sub-type added to the charging master and shown in the Config Viewer; amount-split option not yet built.
- **P3.13 Real attachment upload** — `Attachment.content`/`contentType` (migration `p3_attachment_content`), `addAttachment` reads the posted file's bytes (PDF/PNG/JPEG, ≤7 MB), a download route serves them, file names are clickable. *Verified: uploaded a PDF, served 200 application/pdf.*

*(Batch 1's then-open items — P3.2, P3.5, P3.7, P3.9 amount-split, P3.10, P3.11, P3.12 — were all completed in batch 2 above. P3 is now fully delivered.)*

### P4 — RFI Appendix X gaps *(from the TMC RFI gap assessment, [rfi-gap-assessment.md](rfi-gap-assessment.md); open)*

Net-new pre-trip requirements surfaced by *Appendix X – Functional and Integration Requirements*
(ECS-led, Option 1). The §4.6 payload gap (travel purpose, event dates, approval validity) was
**already closed** (2026-10-02) and is not listed here.

| ID | Item | RFI § | Effort | Status |
|---|---|---|---|---|
| P4.1 | **High-risk travel management** — configurable high-risk destinations; advisory shown to traveller & approver; **mandatory traveller + approver acknowledgements**; notify the relevant office; active-travellers-by-location (crisis) report | §4.8 | M–L | ✅ **done** (2026-10-02) |
| P4.2 | **Visa letter notification** — "visa letter required" flag; post-approval (daily/scheduled) notification to the org-unit-mapped office with the approved travel info; failure handling + audit | §4.13 | M | ✅ **done** (2026-10-02) |
| P4.3 | **Executive & advanced approval workflow** — executive-traveller identification + override route (incl. a separate President path); plus parallel approvals, general escalation, reminders, out-of-office, workflow versioning & effective-dating | §4.12 / §4.12.2 | L | ⬜ open |
| P4.4 | **Policy breadth** — hotel **star rating** and **preferred suppliers** policy dimensions | §4.10 | S | ⬜ open |
| P4.5 | **TES as a distinct eligibility integration** — eligibility/conditions/exceptions with effective dates sourced from a TES boundary (vs today's internal class register), incl. re-validation on amendment | §4.5 | M | ⬜ open |
| P4.6 | **Refunds / airline credits / unused tickets** — inbound sync + a "refunded" booking status + downstream handling | §4.16 / B.2 | M | ◐ TMC-side (ECS consumes) |
| P4.7 | **CTA reconciliation & reversals** — CTA-statement reconciliation; reversal/refund/credit-note postings to ERP; duplicate-claim prevention surfaced | §4.17 / §4.18 | M | ◐ TMC/ERP-side |
| P4.8 | **Reporting breadth** — refunds, unused tickets, carbon emissions, active-travellers-by-location | §4.20 | S–M | ⬜ open |
| P4.9 | **Data portability / bulk export** — open-format export of requests/approvals/bookings/audit | §4.21 | S | ◐ largely TMC-vendor requirement |

Priorities within P4 (ECS pre-trip core first): **P4.1 high-risk** and **P4.2 visa letter** are the
clearest net-new pre-trip features; **P4.3** is the largest. P4.6/P4.7/P4.9 are mostly TMC/ERP
platform mechanics the ECS module references rather than owns.

**P4.1 delivered & verified live (2026-10-02):** `src/data/highRiskDestinations.ts` (configurable
country classification + advisory + source + active flag; in the Config Viewer) + `modules/pretrip/risk.ts`
(detects high-risk from destination/legs) + `HIGH_RISK` policy rule. A high-risk request shows a
**`HighRiskAdvisory`** on review and the approver detail; the traveller must tick a **required
acknowledgement** before submit (server-gated, `TravelRequest.highRiskAck`) and the approver must
acknowledge in a modal to approve (`highRiskApproverAck`); submission **notifies the Risk Management
Office** (audit → risk-office mock email in the notifications feed); and `/reports` has an
**active-travellers-by-location** crisis view flagging high-risk destinations. A bookable high-risk
demo destination (Cairo, Egypt) was added to the location/rate masters. Migration `p4_high_risk_travel`.

**P4.2 delivered & verified live (2026-10-02):** a "visa letter required" flag on the trip step
(`TravelRequest.visaLetterRequired`); `config/visaLetter.ts` maps the recipient immigration office
by organisational unit (department override + University default). After approval the request sits
**Pending** on a new **Visa Letters** page (`/visa-letters`, nav item); a **"Run daily visa-letter
batch"** action (`runVisaLetterBatch`, idempotent via `visaLetterNotifiedAt`) generates a
`VISA_LETTER` notification carrying the §4.13 content (traveller, destination, travel dates, purpose,
funding source, approved TA reference) to the mapped office, audits it, and the notifications feed
shows it as an immigration-office email; failure handling logs an unresolved-recipient case.
Migration `p4_visa_letter`.

### P5 — Multi-TMC & charging UX (delivered 2026-10-05)

| # | Item | Spec | Status |
|---|------|------|--------|
| P5.1 | **Multi-TMC routing** — provider registry; one request routes to ONE TMC (no split-booking per request); explicit-preference → high-risk specialist desk → regional provider → default; provider-specific adapter/PNR; provider tagged on hand-off/booking/messages | RFI Option 1 (multiple TMCs) | ✅ **done** |
| P5.2 | **Charging tab ECS redesign** — cost lines shown first; cross-charge **by travel request OR by cost line**; live computed cost-allocation roll-up per charging account; default account from traveller profile | §17 / ECS cost-allocation parity | ✅ **done** |

**P5.1 delivered & verified live (2026-10-05):** `src/data/tmcProviders.ts` provider registry
(FCM default/global, CTC regional Asia-Pacific, Crisis24 high-risk desk — each with scope, booking
methods, transport, PNR prefix). `src/modules/pretrip/tmcRouting.ts` `resolveTmcProvider(req)` picks
**one** provider by precedence (explicit preference → high-risk specialist → regional covering the
destination → default); the user rule is **no split-booking across TMCs within a request**. Adapter
layer gained per-provider adapters (`adapterFor`) so each TMC stamps its own PNR prefix. Schema:
`TravelRequest.tmcProviderId` (preferred, null = auto), `TravelBooking.tmcProviderId`,
`IntegrationMessage.tmcProviderId`; canonical meta carries `tmc`. Trip form "Preferred TMC" select,
booking page shows the routed provider + reason, Config Viewer "TMC Providers" card. Verified all four
paths (default / regional / high-risk / explicit override). Migration `multi_tmc_provider`.

**P5.2 delivered & verified live (2026-10-05):** the Charging step now shows the **estimated cost
lines first** (gross / sponsor / NTU-funded), then a **Charging & Cost Allocation** section with an
**Allocate: By travel request / By cost line (cross-charge)** toggle and a **live computed
cost-allocation roll-up** per charging account at the bottom. `ChargingAllocation` stays the canonical
request-level split that drives all routing (§13.14 / §18 / §6.2) and the review/finance breakdowns;
in by-line mode `saveCharging` aggregates each line's NTU-funded amount onto its account
(`chargingRollup.ts` `rollupByCode`, shared with the live UI) and writes the effective allocation rows
+ persists `EstimatedExpense.chargingCode`. Default account = the traveller's profile
`defaultChargingCode` (department-derived). Migration `charging_mode_and_line_code`.

---

## 4. Suggested sequencing

1. **P0** — reshape the route first; it changes what every later step snapshots.
2. **P1.2 then P1.1** — the two failed ACs (fan-out is cheaper than guest).
3. **P2.1 → P2.3** — the charging/airfare/claim thread (coherent, high value, enabled by D1).
4. Remainder of **P2** (evidence + config-driven policy).
5. **P3** breadth as capacity allows; Notifications/Reporting are large but not AC-blocking.

---

## 5. Still-open policy placeholders to confirm with Finance (§51)

DOA thresholds/bands · research threshold & route · low-value DOA bypass · cross-charge threshold ·
approved-vs-booked tolerance · amendment reapproval triggers · guest approval rules · whether the
Additional Approver step is on by default. Keep all as **configuration**, not code.

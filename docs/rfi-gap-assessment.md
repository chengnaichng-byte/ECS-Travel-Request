# RFI Appendix X — Pre-Trip Gap Assessment (ECS-led, Option 1)

Assessment of the **ECS Pre-Trip prototype** against *Appendix X – Functional and Integration
Requirements* (NTU TMC RFI). The RFI describes two operating models; the prototype is the
**ECS side of Option 1 (ECS-led Travel Governance)** — ECS is the system of record for pre-trip
requests and approvals and hands approved requests to the TMC. Requirements that are inherently
TMC-platform or ERP mechanics (which ECS consumes or references, not owns) are marked accordingly.

**Scope note.** The codes map the RFI's Appendix-A capability scale to *what the prototype
demonstrates today*, not a production TMC-vendor response:

| Code | Meaning (as applied here) |
|---|---|
| **S** | Built and demonstrated in the prototype |
| **C** | Present but configuration/extension to fully satisfy |
| **M** | Minor build needed |
| **X** | Major build needed |
| **N** | Not supported in the prototype |
| **—** | Out of ECS pre-trip scope (TMC/ERP platform or NFR) |

## Section 4 — Functional Integration Requirements

| § | Requirement | Code | Coverage | Notes |
|---|---|---|---|---|
| 4.2 | Integration architecture (REST, auth, sync/async, event-driven) | C | Partial | Canonical provider-neutral contract + provenance envelope + message guards; connectivity is mock (no live REST/auth) |
| 4.3 | Employee master data | C | Covered | Master has ID, name, worker type, org/dept, CC/WBS (default charging), email, RO; **employment status** not modeled; reused read-only (mock sync) |
| 4.4 | Guest / external travellers (requestor ≠ traveller) | **S** | Covered | Guest type + identity capture, host/sponsor captured, identities separated through booking & payload, audited |
| 4.5 | TES eligibility / class entitlement | M | Partial | Class register (effective-dated, duration-conditioned) + eligibility flag + class-exception routing; **TES as a distinct source system** (conditions/exceptions/effective-date sync) not modeled |
| 4.6 | Pre-trip payload to TMC (traveller, purpose, itinerary, dates, event dates, class, CC/WBS, funding, budget, approval ref, validity) | **S** | Covered | All fields now in the outbound contract — **travel purpose, event dates and approval validity added 2026-10-02** to close the former gap |
| 4.7 | Cross-charging & multi-funding (multi CC/WBS, %-based, amount-based, traveller-level, funding-owner routing) | **S** | Covered | All present, incl. amount-split entry and cross-BA funding-owner concurrence |
| 4.8 | **High-risk travel management** (designation, advisories, traveller+approver acknowledgement, crisis location reporting) | **S** | Covered | **Built 2026-10-02 (P4.1)** — configurable high-risk destinations, advisory to traveller & approver, mandatory traveller + approver acknowledgements, Risk-Office notification, active-travellers-by-location report |
| 4.9 | Personal travel declaration (separate business/personal, justification, downstream to claims) | S | Covered | Declaration + personal legs/dates + acknowledgement + excluded from funded cost; *business-only-fare-vs-actual comparison* partial; traveller-funded **upgrade payment split** is Option-2/TMC-side (N) |
| 4.10 | Policy compliance (entitlement, hotel caps, **star rating**, **preferred suppliers**, class, destination rules, thresholds, tolerances) | C | Partial | Caps (city+country), class entitlement, thresholds (bands), tolerances, config-driven rules; **hotel star rating & preferred suppliers** not modeled |
| 4.11 | DOA (Option 1: accept ECS approval, preserve ref, no duplicate) | S | Covered | ECS determines DOA by band/dept line + delegations; issues TA reference carried to TMC; *acting appointments / effective-dated authorities* shallow |
| 4.12 | Configurable approval workflow | C | Partial | Research/value/cross-BA/exception/funding-owner routing + sequential + config toggles; **parallel, general escalation, reminders, OOO, workflow versioning/effective-dating** not present |
| 4.12.2 | **Executive approval workflow** (identify execs, override route, President path) | **N** | Gap | Not modeled |
| 4.13 | **Visa letter request notification** (flag, post-approval daily notification, recipient by org unit) | **S** | Covered | **Built 2026-10-02 (P4.2)** — "visa letter required" flag; daily batch notifies the org-unit-mapped immigration office with traveller/destination/dates/purpose/funding/TA-ref; audit + failure handling |
| 4.14 | Booking integration (PNR, ticket, values, taxes, fees) | S | Covered | Inbound booking capture (air + hotel); **vehicle**, explicit currency/exchange on booking minor gaps |
| 4.15 | Booking validation (vs approval/budget/tolerance, material-change re-approval, class vs entitlement) | S | Covered | Deviation/tolerance check + material-amendment re-approval + guards gate handoff/receive |
| 4.16 | Amendments & cancellations (incl. **refunds, airline credits, unused tickets**) | C | Partial | Amendment re-approval + TMC retransmit; cancellation with cancel-ref + fee; **refunds/credits/unused tickets** not modeled |
| 4.17 | CTA settlement → direct ERP; non-reimbursable in claim; reconciliation/reversals | C | Partial | Direct airfare→SAP posting; airfare shown non-reimbursable in claim; **CTA-statement reconciliation, reversals/refunds** not modeled |
| 4.18 | ERP integration for ticketing (airfare, taxes, fees, CC/WBS, booking ref, ticket; reversals/refunds) | C | Partial | SAP posting (GL + cost objects + booking refs); currency/exchange (SGD only), **reversals/refunds/credit notes** not modeled |
| 4.19 | ECS expense-claim integration (auto-populate, match, variance, status sync) | **S** | Covered | Claim prepopulation with booked amounts + booking ref + estimate-to-actual + cumulative netting |
| 4.20 | Reporting & audit | S/C | Partial | Full audit trail; reports cover requests/bookings/exceptions/spend; **refunds, unused tickets, carbon, active-travellers-by-location** not covered |
| 4.21 | Data portability & exit (bulk export, open formats, data dictionary) | N | Gap | No export feature (largely a TMC-vendor requirement; ECS data lives in the ECS/Prisma store) |

## Appendix B — Technical Integration Specifications

| § | Requirement | Code | Coverage | Notes |
|---|---|---|---|---|
| B.1 | Transaction correlation & matching keys (TR→booking→PNR→ticket→txn→ECS; ECS ref returned unchanged) | S | Covered | TA number is the immutable ECS reference carried out→back; provenance envelope (messageId/correlationId) correlates messages |
| B.2 | Travel status model (requested→approved→booked→ticketed→amended→cancelled→**refunded**→completed, with history) | C | Mostly | Request + booking lifecycle incl. Received-by-TMC/In-Progress/Travel-Completed, audited with actor/timestamp; **no "refunded" status** |
| B.3 | Integration triggers, push/pull, idempotency, replay | C | Partial | Event-triggered, idempotent handoff/receive, provenance meta; *replay/resync/ordering* not built |
| B.4 | Non-functional requirements (availability, DR, security, performance) | — | Out of scope | Prototype, not a production platform |
| B.5 | Non-production environment & integration testing | — | Out of scope | TMC-vendor requirement |

## Business scenario coverage (§6)

| Scenario | Prototype |
|---|---|
| 1 Standard non-research | ✅ end-to-end |
| 2 Research travel | ✅ research DOA line |
| 3 Cross-charged | ✅ cross-BA routing + ERP cost objects |
| 4 Group travel | ✅ fan-out + traveller-level funding |
| 5 Booking amendment | ✅ re-approval + retransmit |
| 6 Travel cancellation | ◐ cancel + fee; **no refund/credit** |
| 7 Policy exception | ✅ exception route |
| 8 Workflow configuration | ◐ settings toggles, **not a full workflow builder** |
| 9 DOA integration | ✅ (Option 1, ECS-led) |
| 10 ERP integration | ✅ SAP posting; ◐ reversals/refunds |
| 11 ECS integration | ✅ handoff + booking sync + claim |
| 12 Administration & configuration | ✅ settings / config viewer / integration contracts |

## Verdict

The prototype covers the **large majority of the ECS-side (Option 1) pre-trip requirements** and
demonstrates all 12 scenarios at least in part. The genuine **pre-trip gaps worth closing** are
captured as **P4** in [backlog.md](backlog.md): ~~high-risk travel (4.8)~~ **[done, P4.1]**,
~~visa-letter notification (4.13)~~ **[done, P4.2]**, executive & advanced workflow (4.12/4.12.2),
hotel star-rating & preferred suppliers (4.10), and the TES-as-a-system integration (4.5). Refunds/credits/unused tickets, CTA
reconciliation and reversals, data portability and non-prod environment are **TMC/ERP-platform
mechanics** the ECS pre-trip module references rather than owns.

*(The former §4.6 payload gap — travel purpose, event dates, approval validity period — was closed
on 2026-10-02 and verified in a live hand-off.)*

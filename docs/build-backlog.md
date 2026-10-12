# ECS Pre-Trip — Build Backlog (post-CFO review)

Derived from the decision set in the Build Specification (DD-13 revised, DD-17–DD-25) and the open items (O-1–O-6). Each epic maps to a design decision, with impact area, effort (S/M/L), priority, dependencies and the key stories/acceptance notes.

**Priority:** P1 = architectural / blocker · P2 = shapes design, build after/with P1 · P3 = refinement.
**Impact areas:** DATA (model/migration) · WF (workflow/routing) · INT (integration/TMC) · UI · CFG (config/reference).

---

## P1 — foundational

### E2 · Multiple PNRs per Travel Request/Claim — **DD-17** — ✅ BUILT
- **Impact:** DATA · INT · UI · WF — **Effort: L** — **Dep:** none (do first)
- **Status:** built & verified — a multi-city inbound splits into **N PNRs** (air by journey, hotel on PNR A), the booking page lists each PNR with its leg coverage, and the claim **aggregates** booked airfare across PNRs under one TR → one claim. *(Minor: accommodation booked is spread evenly across accommodation lines — refine to per-city later.)*
- **Stories**
  - Booking model becomes **1 request → N bookings (one per PNR)**; keep 1 request → 1 claim.
  - **PNR ↔ leg mapping** so a cost line reconciles to the right ticket.
  - Inbound handling records **each PNR** returned by the TMC (multi-PNR fan-out, not one-per-traveller only).
  - Booked-vs-approved **deviation on the aggregate** airfare across PNRs.
  - Claim pre-population **aggregates** booked amounts across PNRs; detail/claim UI lists each PNR.
- **Acceptance:** a multi-city trip with 2 PNRs books, reconciles and claims as one TR/claim with both PNRs visible and totalled.

---

## P2 — shapes design (build after/with E2)

### E1 · Group = employees-only — **DD-13** — ✅ BUILT
- **Impact:** CFG · UI · (settlement) — **Effort: S–M** — **Dep:** none
- **Status:** built & verified — `groupGuestMixAllowed` defaults **OFF**; the group create form replaces the guest section with an *"employees-only — raise a separate Guest request"* note (and bulk-upload rejects guest rows); the **guest settlement / host direct-bill card now renders on the standalone Guest request** (aggregating billed across PNRs), not only on a group. Guest rules (Economy default, no ODA, no shared line, host direct-bill) confirmed on the Guest request.
- **Stories**
  - Default `groupGuestMixAllowed = OFF`; create form hides the guest section for groups. ✅
  - **Move guest settlement / host direct-bill view to the standalone Guest request** (was group-only). ✅
  - Confirm guest rules (Economy default, no ODA/shared, host direct-bill) apply on the **Guest request**. ✅
- **Acceptance:** a group can only hold employees; a guest is raised on the Guest request and shows the settlement line. ✅

### E10 · Guest class upgrade + Provost approval — **DD-25**  *(new this round)*
- **Impact:** CFG (reference) · UI · WF · INT — **Effort: M** — **Dep:** O-6 (Provost source)
- **Build approach**
  1. **Reference master:** per-school **Provost list** (`provosts` data → mock `EcsProvost.forSchool()`), plus a **Provosts maintenance** screen under Setup & Maintenance (list + add/edit).
  2. **Model:** reuse `travelClassId` / `entitledClassId` / `classJustification`; add the selected approver as a **PROVOST** approval step (new `APPROVER_ROLE.Provost`).
  3. **UI (Guest request airfare):** enable the **class picker** for a guest (today Economy-locked); when class > Economy show a **required justification** + a **Provost select** from the host school's list.
  4. **Policy:** a guest class above Economy raises a **guest-upgrade exception** (hard-stop if no justification — mirrors CLASS/CLASS_JUSTIFY, guest-scoped).
  5. **Routing:** `buildRoute` inserts a **Provost step** (approverId = selected Provost) for the guest upgrade, ahead of the host DOA (Provost approves the upgrade; DOA owns the cost).
  6. **TMC:** the approved upgraded class flows as `approvedClass`; `approvedExceptions` carries "Guest class upgrade — Provost-approved (<name>)".
- **Acceptance:** a guest Business-class request with justification routes to the host school's Provost; on approval the upgraded class + exception reach the TMC.

### E4 · CTA central payment (group hotels) — **DD-19**
- **Impact:** DATA · INT — **Effort: M** — **Dep:** E1; O-4 (policy beyond group)
- **Stories:** CTA entitlement on a group; **hotel block-booking**; **CTA indicator** in the outbound; restrict CTA to group travel.

### E5 · Upgrade-cost split allocation — **DD-20**
- **Impact:** CFG · DATA · INT — **Effort: M–L** — **Dep:** O-5 (percentages, Finance)
- **Stories:** configurable **base → operating / project**, **differential → reserve (M6)**; proxy % per scenario; split **passed to the TMC**/finance interface.

### E3 · Deterministic hand-off routing — **DD-18**
- **Impact:** WF · UI — **Effort: M** — **Dep:** group per-traveller dates
- **Stories:** detect itinerary **variations** (per-traveller dates, extensions, complex multi-city) → force **agent-assisted/offline**; allow straight-through **online only when deterministic**.

### E7 · Cancellation lifecycle — **DD-22** — ✅ BUILT
- **Impact:** WF · INT — **Effort: M** — **Dep:** none
- **Status:** built & verified — cancellation is now a **two-way** lifecycle:
  - **Before hand-off / no live booking** (Not Sent, Self-Booked, Failed) → cancelled **locally**: booking → Cancelled, **no TMC message, no fee**.
  - **After transmitted / booked** → an outbound **`TMC_CANCEL` (BOOKING_CANCEL_REQUEST)** is sent and the booking holds at a new **`Cancellation Requested`** status; the inbound **`receiveCancellation` (BOOKING_CANCEL_CONFIRMATION)** settles the actual **cancellation fee + refund** (correlated by `messageId`) and marks the booking **Cancelled**.
  - The request's authorisation is **voided immediately** on cancel, so the **duplicate guard** (terminal statuses excluded) no longer blocks a re-raise.
  - UI: booking page shows the in-flight "Cancellation requested — awaiting TMC confirmation" panel with a receive-confirmation action, plus side-by-side **Cancellation Request / Confirmation** payload cards.
- **Acceptance:** a booked request cancels via a TMC round-trip that settles the fee/refund; a not-yet-sent request cancels locally; a cancelled request frees a re-raise. ✅

### E8 · Emergency / retrospective lane — **DD-23**
- **Impact:** WF · UI — **Effort: M** — **Dep:** none
- **Stories:** book-first on **authorised approval**; **retrospective TR + approval**; bounded, audited scenario (not a general bypass).

### E6 · Guest profile via TMC (PDPA) — **DD-21** — ✅ BUILT
- **Impact:** INT · UI — **Effort: S** — **Dep:** none
- **Status:** built & verified — the outbound booking instruction carries a **`guestProfile`** block for GUEST bookings only: `collectVia: TMC_SECURE_LINK`, `deliverTo` (guest e-mail), the **TMC-collected fields** (passport no./expiry, nationality, DOB, contact, FF/dietary) and `ecsRetains: "name, e-mail & organisation only"`. It is **governed by a new Integration-Contract toggle** ("Guest profile collection (TMC secure link)", default on) and is **omitted for employee requests**. A **PDPA callout** on the Guest Settlement card states ECS stores name/e-mail/org only and the TMC collects the rest. *(Also surfaced the previously-hidden "Charging & context" enrichment toggles in the admin table.)*
- **Stories:** booking-instruction **indicator** → TMC sends the guest a profile/passport link ✅; ECS stores **name/email/org only** ✅.
- **Acceptance:** a guest request's outbound payload instructs the TMC to collect the guest profile via a secure link; ECS holds no guest PII beyond name/email/org. ✅

### E9 · Approver dashboard tabs + one-page summary — **DD-24**
- **Impact:** UI · INT (platform) — **Effort: M** — **Dep:** ECS dashboard
- **Stories:** **TR / Expense-Claim tabs** in the ECS approval dashboard; **one-page** approver summary; **exception emphasis**.

---

## P3 — refinements

### E11 · Claim auto-DOA on charging change — **DD-08 (update)**
- **Impact:** WF — **Effort: S** — a changed charging account routes to the **new account's DOA**; auto-grant otherwise (threshold per O-1).

### E12 · Multi-TMC confirmations — **D-03**
- **Impact:** CFG — **Effort: S** — confirm a **default/main TMC** setting and selectable-where-permitted *(mostly built).* 

---

## Already aligned — no build (confirm only)
Three request types · trip structures (round/one-way/multi-city/country) · self-booking skips hand-off · Additional Approver · Approve/Send-Back no Reject (DD-12) · group bypasses RO→DOA (DD-03) · Verifier absent from pre-trip · two-way, TMC-independent, rules-in-ECS integration (DD-25 era §12) · claim-from-TR with pre-populated booking · **cost estimate retained as-is (DD-16).**

## Pending decisions that gate epics (do not build until confirmed)
- **O-1** variance tolerance (gates E11 figures)
- **O-2** broader RO/DOA policy
- **O-3** student group travel (separate)
- **O-4** CTA policy beyond group (gates E4 scope)
- **O-5** upgrade-cost percentages (gates E5 config — Finance)
- **O-6** Provost list source/governance (gates E10 reference)

## Suggested sequence
1. ~~**E2** (multi-PNR, P1 foundational)~~ ✅ → 2. ~~**E1** (group flip, quick win)~~ ✅ → 3. ~~**E6**~~ ✅ **/** ~~**E7**~~ ✅ **/ E11** (small) → 4. **E10 / E3 / E8** → 5. **E4 / E5** (await O-4 / O-5) → 6. **E9** (platform-dependent).

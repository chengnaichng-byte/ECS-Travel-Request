# ECS Pre-Trip Travel Request — Prototype

An ECS-native pre-trip travel approval prototype, built as a **functional and data-model
reference implementation** for the eventual OutSystems build (Build Pack §11). Its
purpose is to validate requirements, screen flows, workflow behaviour and the TE
pre-population contract — **not** to produce production code.

The prototype demonstrates three things end to end (§12):

1. **Create** — a traveller or requestor creates a pre-trip request with trip details,
   estimated airfare / accommodation / ODA, sponsorship and charging.
2. **Approve** — the request routes through the configured RO and/or DOA route, with
   policy checks and exception handling, ending in an approved request and a **Travel
   Authorisation Number** (`TA-YYYY-NNNNNN`).
3. **Claim** — after travel, a TE claim is created from the approved request and
   **pre-populated** per the §13.8 mapping, with approved values shown alongside actuals.

## Tech stack (§11.3)

Next.js (App Router) · TypeScript · Prisma · SQLite · Tailwind CSS.

All business rules, field mappings and workflow configuration live in
data/configuration files (`src/data`, `src/config`) rather than hard-coded logic, so
they translate directly into OutSystems entities and site properties.

## Running

```bash
npm install
npx prisma generate
npx prisma migrate dev     # creates prisma/dev.db
npx prisma db seed         # seeds the ModuleSettings row
npm run dev                # http://localhost:3000
```

Then open the dashboard and click **“Load demonstration scenarios”** to seed the §8.1
scenarios (S01 standard, S02 research, S03 hotel-above-cap) end to end.

> **OneDrive note:** this project lives under OneDrive. `node_modules` is git-ignored,
> but OneDrive may still try to sync it — if syncing is slow, mark `node_modules` as
> “Always keep on this device / Free up space” or exclude it from the OneDrive folder.

## Demonstration script (§12.1)

1. **Traveller (Dr Alice Tan)** creates a Singapore→Tokyo conference request; ECS-derived
   profile, RO and DOA are shown automatically.
2. Adds airfare, accommodation (within cap) and ODA; the summary shows gross estimate,
   expected sponsorship and estimated NTU-funded cost (§4.6).
3. Enters charging totalling 100%; policy review passes; submits for approval.
4. Switch persona to **RO (Prof Ben Lim)** → approve; status moves to *Pending DOA*.
5. Switch to **DOA (Prof Carol Wong)** → approve; **Travel Authorisation Number** issued.
6. Back as the traveller: **Create TE claim** → the claim opens pre-populated (§13.8).
7. Confirm locked fields, edit editable actuals, submit.
8. **Estimate-to-actual** shows approved estimate, booked amount, actual claim and variance.

A second pass repeats steps 1–5 with the **hotel-above-cap exception (S03)** to show
the exception-approver route (RO → Exception Approver → DOA).

Use the **persona switcher** (top-right) to assume any of the seeded personas.

## Repository structure (§9)

| Path | Contents |
|------|----------|
| `src/modules/pretrip` | Pages logic, workflow route builder, policy engine, pricing, server actions |
| `src/modules/te` | TE pre-population mapping (§13.8) and claim actions |
| `src/shared/ecs` | Mock ECS core services (identity, roles, reference data, policy, charging, workflow, FX) |
| `src/integrations/tmc` | Canonical TMC contract + mock provider adapter + payloads (§13.9) |
| `src/config` | Prototype decision switches only (§3.4) |
| `src/data` | Seeded ECS reference masters (§13.7), consumed read-only by ID |
| `src/app` | Screens / routes (TR-01 … TR-19) |
| `docs` | Field authority, integration contract, traceability |

See `docs/` for the field-authority mapping, integration contract and a
screen/acceptance-criteria traceability matrix.

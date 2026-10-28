# One-time data backfills

Notes on data fixes applied outside the normal flow. In the prototype the dev database is reseeded,
so these are records for a real deployment rather than standing migrations.

## Default charging allocation for pre-existing drafts (2026-10-28)

Fix `87fa718` seeds a default 100% main charging allocation at request creation (`createDraft` /
`createGuestDraft`, via `seedDefaultCharging`). Drafts created **before** that fix have no
`ChargingAllocation` and therefore raise a **"No charging allocation entered"** hard stop at Policy
Review, even though the Charging step shows a default account.

**Backfill:** for each `Draft` / `Sent Back` request with no `ChargingAllocation`, create a 100% main
allocation from the traveller's profile cost object (the host's, for a guest) — the same default
`seedDefaultCharging` applies at creation. The master-derived fields (charging type, business area,
research flag) come from the charging-code master.

`TR-2026-000028` (a test draft) was backfilled this way with `CC-1000`.

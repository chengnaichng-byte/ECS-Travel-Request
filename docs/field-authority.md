# TE Claim Pre-Population — Field Authority (§13.8)

Per §13.11, where the detailed field-catalogue workbook is absent, **§13.8 and the seed
data specification in §13.7 serve as the interim field authority**. This document
records the mapping the prototype implements (`src/modules/te/prepopulate.ts`).

When a claimant selects an approved Travel Request (or uses *Create Claim from Travel
Request*), the claim is pre-populated as follows.

Treatment values:

- **Locked** — copied, not editable.
- **Editable** — copied as default, claimant may change.
- **Reference** — displayed for comparison only, not part of the claim.
- **Excluded** — not carried over.

## Header fields

| TE field / area | Source from Travel Request | Treatment |
|---|---|---|
| Traveller, employing entity, department | Request header (ECS-derived) | Locked |
| Travel Request Number and Travel Authorisation Number | Request header | Locked |
| Travel purpose and description | Trip header | Locked |
| Main destination country and city | Trip header | Locked |
| Official travel dates | Approved dates | Editable within amendment tolerance |
| Travel class (and booked class where available) | Approved class | Reference |
| Charging account and cost allocation | Approved allocation | Locked (controlled override per module setting) |

## Expense lines

| TE line | Source | Treatment |
|---|---|---|
| Airfare | Approved airfare estimate + booked fare | **Reference** if airfare treatment is *Direct SAP* / *TMC-settled*; otherwise **Editable** (estimate as default, quotation attached) |
| Accommodation | Approved city, nights and budgeted rate | Editable — actual stay dates, actual amount and receipt; approved cap and estimate shown as Reference |
| ODA | Approved destinations and eligible dates | Editable — recalculated from actual travel dates; approved indicative amount shown as Reference |
| Conference fee / other permitted costs | Approved estimate lines | Editable with receipts; lines excluded from approved scope cannot be added without a policy exception |
| Expected sponsorship | Approved sponsorship | Editable; reduction requires justification |
| Attachments (quotes, approvals) | Request attachments | Reference; claim requires its own receipts |
| Approved estimate totals | Approved version | Reference; shown in the estimate-to-actual panel with per-line variance |

## Rules

- One approved Travel Request may link to **multiple** TE claims (interim + final);
  cumulative claimed amounts are compared against the approved estimate (AC17).
- **Mandatory linkage** (module setting `teLinkageMandatory`): when *Yes*, a claim cannot
  be submitted without an approved Travel Request covering the claim dates; when
  *Conditional*, the requirement applies only to configured travel purposes.
- **Group requests** (§13.14): pre-population is filtered to the selecting traveller's
  attributed lines and apportioned shares; other travellers' costs are not visible.
- **Self-booked trips** (§13.17): the booked-amount column is *N/A*; deviation is checked
  at claim against the approved ceiling and class.
- Approved values remain traceable; edits are recorded as actual values / variances
  rather than overwriting the approved request (§8.3).

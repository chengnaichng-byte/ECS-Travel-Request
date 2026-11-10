# Document generators

These scripts regenerate the two developer Word documents in `docs/` from the prototype
source, so the documents can be rebuilt reproducibly rather than hand-edited:

| Script | Produces | Source of truth |
|---|---|---|
| `gen_integration.js` | `docs/NTU-Travel-Request-Integration-Contract.docx` | `src/config/integrationContracts.ts`, `src/integrations/tmc/{contract,adapter,vocab}.ts`, `src/modules/pretrip/{integration,tmcRetrieval,tmcPayload,bookingDeviation}.ts`, `prisma/schema.prisma` |
| `gen_datadict.js` | `docs/NTU-Travel-Request-Data-Dictionary.docx` | `prisma/schema.prisma` (all models) |

Contract version documented: `ecs-pretrip-contract/1.3`.

## Prerequisites

The scripts use [`docx`](https://www.npmjs.com/package/docx). It is **not** a runtime dependency
of the prototype — it is declared in this folder's own `package.json`, so install it here before
regenerating (the resulting `node_modules/` is git-ignored):

```bash
cd docs/generators
npm i
```

The data dictionary embeds the three ERD images (`erd-a.png`, `erd-b.png`, `erd-c.png`), which are
committed alongside the script and read from this folder. They were produced from Mermaid
entity-relationship sources rendered to PNG (headless Chrome). Regenerate them only if the data
model changes; the three cover the request/itinerary, approval/booking, and claim/integration
subsystems respectively.

## Regenerate

From this folder, with an explicit output path into `docs/`:

```bash
node gen_integration.js ../NTU-Travel-Request-Integration-Contract.docx
node gen_datadict.js ../NTU-Travel-Request-Data-Dictionary.docx
```

Close the target file in Word first (Word holds an exclusive lock; the write fails with `EBUSY`
otherwise).

## Conventions baked into the scripts

- **No em dashes** anywhere in the generated text (house rule). Use a colon or two sentences.
- The covers are dated **6 November 2026** (fixed, not the system date).
- Preserved wording that must not be silently rewritten: Integration Contract §6, §6.2 and §10; the
  §11 change log (append rows, do not rewrite); and the Data Dictionary cover subtitle and note box.
- `docx` gotchas honoured here: 6-digit hex colours only, `ShadingType.CLEAR`, DXA table widths,
  `ImageRun` with `type: 'png'`.

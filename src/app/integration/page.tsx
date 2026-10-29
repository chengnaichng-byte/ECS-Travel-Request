// TR-20 Integration Contracts — the admin-editable definition of what is sent to the
// TMC (booking instruction, §13.9) and what is synced to the expense claim (§13.8).
// Editing a flag here changes the real payloads: buildOutbound and prepopulateClaim
// both read this contract. A live preview renders the governed payloads for a chosen
// approved request so definition and result sit side by side.
import { prisma } from '@/shared/db';
import { currentPersona } from '@/shared/session';
import { getSettings } from '@/modules/pretrip/settings';
import { loadRequest } from '@/modules/pretrip/queries';
import { getContractSettings, tmcEnabledSet, prepopContract, getGuardSettings, evaluateFlow, guardRuleText } from '@/modules/pretrip/integration';
import { assembleOutbound } from '@/modules/pretrip/tmcPayload';
import { simulateInbound } from '@/integrations/tmc/adapter';
import { OBT_BOOKING_STATUS_LABEL, SEGMENT_STATUS_LABEL, obtToEcsBookingStatus } from '@/integrations/tmc/vocab';
import { INBOUND_FEED_SPEC, FEED_CONSUMER_LABEL } from '@/config/inboundFeed';
import { prepopulateClaim } from '@/modules/te/prepopulate';
import { CONTRACT_FIELDS, TE_TREATMENT_OPTIONS, GUARD_PARAM_OPTIONS, GUARD_PARAM_LABELS, guardEditable, CONTRACT_VERSION } from '@/config/integrationContracts';
import { expenseTypes } from '@/data/expenseTypes';
import { saveContractSettings, saveContractGuards } from '@/app/actions';
import { REQUEST_STATUS, ROLE } from '@/shared/enums';
import { PageTitle, Card, Empty } from '@/components/ui';
import { TreatmentPill } from '@/components/StatusPill';

export const dynamic = 'force-dynamic';

const TMC_GROUPS = ['Booking header', 'Itinerary', 'Accommodation', 'Charging & context', 'Guest (PDPA)'];
const sgd = (n?: number | null) => n == null ? '—' : 'SGD ' + Number(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TE_GROUPS = ['Claim header', 'Claim lines', 'Claim actuals', 'Booking confirmation (feed)', 'CTA charges (feed)', 'Cancellation & change (feed)'];

export default async function IntegrationContractsPage({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const { preview } = await searchParams;
  const persona = await currentPersona();
  const isAdmin = persona.roles.includes(ROLE.TravelAdmin) || persona.roles.includes(ROLE.SystemAdmin);
  const resolved = await getContractSettings();
  const guards = await getGuardSettings();
  const settings = await getSettings();

  // Any request may be previewed so the parameter filters can be shown blocking a
  // not-yet-eligible request (e.g. still Pending) as well as passing an approved one.
  const requests = await prisma.travelRequest.findMany({
    select: { id: true, requestNumber: true, authorisationNo: true, isGroup: true, status: true },
    orderBy: { requestNumber: 'asc' },
  });
  const previewId = preview ?? requests.find((r) => r.status === REQUEST_STATUS.Approved)?.id ?? requests[0]?.id;
  const req = previewId ? await loadRequest(previewId) : null;

  // Deterministic preview provenance (a real send stamps a fresh UUID + timestamp).
  const previewMeta = req ? { messageId: `preview-${req.requestNumber}`, sentAt: req.updatedAt.toISOString(), sourceStatus: req.status, contractVersion: CONTRACT_VERSION } : undefined;
  const outbound = req ? assembleOutbound(req, tmcEnabledSet(resolved), previewMeta) : null;
  // Deterministic inbound preview — the simulated TMC confirmation, so the per-charge CTA
  // datapoints the feed carries for the SAP posting (DD-31) are visible beside the outbound.
  const inbound = outbound ? simulateInbound(outbound, { chargeDate: req?.updatedAt.toISOString().slice(0, 10) ?? null }, { messageId: `preview-in-${req?.requestNumber}`, receivedAt: req?.updatedAt.toISOString() ?? '', correlationId: previewMeta?.messageId ?? null, sourceStatus: req?.status ?? '', contractVersion: CONTRACT_VERSION }) : null;
  const prep = req ? prepopulateClaim(req, req.travellerId, settings.airfareTreatment, prepopContract(resolved)) : null;
  const outGate = req ? evaluateFlow(req, 'OUTBOUND', guards) : null;
  const inGate = req ? evaluateFlow(req, 'INBOUND', guards) : null;
  const teGate = req ? evaluateFlow(req, 'TE_SYNC', guards) : null;

  const tmcFields = CONTRACT_FIELDS.filter((f) => f.tmc);
  const teFields = CONTRACT_FIELDS.filter((f) => f.te);
  const outGuards = guards.filter((g) => g.flow === 'OUTBOUND');
  const inGuards = guards.filter((g) => g.flow === 'INBOUND');
  const teGuards = guards.filter((g) => g.flow === 'TE_SYNC');

  return (
    <div className="w-full space-y-5">
      <PageTitle id="TR-20" title="Integration Contracts"
        subtitle="Define what is sent to the TMC (booking instruction, §13.9) and what is synced to the expense claim (§13.8). These flags map to the OutSystems exposed-REST structure and site properties; changing one changes the real payload shown in the live preview."
      />

      {!isAdmin && <div className="card p-3 text-sm text-amber-800 bg-amber-50 border-amber-200">Switch persona to <strong>David Kumar — Travel Administrator</strong> (or System Administrator) to edit the contract. The definition below is read-only for other roles.</div>}

      <form action={saveContractSettings} className="space-y-5">
        {/* ------------------------------- Send to TMC ------------------------------- */}
        <Card title="A · Send to TMC — booking instruction (§13.9)">
          <p className="text-xs text-[var(--ecs-muted)] mb-3">The provider-neutral payload the TMC needs to book. Charging (CC/WBS), ODA and the internal approval chain are deliberately never sent.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">Field</th><th className="th">Source</th><th className="th text-center">Sent to TMC</th><th className="th">Notes</th></tr></thead>
              <tbody>
                {TMC_GROUPS.map((g) => {
                  const rows = tmcFields.filter((f) => f.group === g);
                  if (!rows.length) return null;
                  return (
                    <FragmentGroup key={g} label={g} cols={4}>
                      {rows.map((f) => (
                        <tr key={f.key} className="hover:bg-[var(--ecs-panel-2)]">
                          <td className="td font-medium">{f.label}</td>
                          <td className="td text-xs text-[var(--ecs-muted)] font-mono">{f.source}</td>
                          <td className="td text-center">
                            {f.tmc === 'core'
                              ? <span className="pill-navy">Always</span>
                              : <input key={String(resolved[f.key].includeTmc)} type="checkbox" name={`tmc__${f.key}`} defaultChecked={resolved[f.key].includeTmc} disabled={!isAdmin} className="w-4 h-4" />}
                          </td>
                          <td className="td text-xs text-[var(--ecs-muted)]">{[f.transform, f.note].filter(Boolean).join(' · ') || '—'}</td>
                        </tr>
                      ))}
                    </FragmentGroup>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* -------------------------- Sync to Expense Claim -------------------------- */}
        <Card title="B · Sync to Expense Claim (TE) — pre-population (§13.8)">
          <p className="text-xs text-[var(--ecs-muted)] mb-3">Per-field treatment when a claim is created from an approved request. <strong>Locked</strong> copied &amp; non-editable · <strong>Editable</strong> defaults to approved · <strong>Reference</strong> shown for comparison · <strong>Excluded</strong> not pre-populated.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">Field</th><th className="th">Source</th><th className="th">Treatment in claim</th><th className="th">Notes</th></tr></thead>
              <tbody>
                {TE_GROUPS.map((g) => {
                  const rows = teFields.filter((f) => f.group === g);
                  if (!rows.length) return null;
                  return (
                    <FragmentGroup key={g} label={g} cols={4}>
                      {rows.map((f) => (
                        <tr key={f.key} className="hover:bg-[var(--ecs-panel-2)]">
                          <td className="td font-medium">{f.label}</td>
                          <td className="td text-xs text-[var(--ecs-muted)] font-mono">{f.source}</td>
                          <td className="td">
                            {/* key bound to the saved value forces this control to remount after a
                                save so it snaps to the persisted treatment (defaultValue alone
                                would not update on a server-action re-render). */}
                            <select key={resolved[f.key].teTreatment} name={`te__${f.key}`} defaultValue={resolved[f.key].teTreatment} disabled={!isAdmin} className="field w-40 py-1">
                              {TE_TREATMENT_OPTIONS.map((o) => <option key={o} value={o}>{o.charAt(0) + o.slice(1).toLowerCase()}</option>)}
                            </select>
                          </td>
                          <td className="td text-xs text-[var(--ecs-muted)]">{f.note ?? '—'}</td>
                        </tr>
                      ))}
                    </FragmentGroup>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {isAdmin && (
          <div className="flex justify-end">
            <button type="submit" className="btn-primary">Save integration contract</button>
          </div>
        )}
      </form>

      {/* --------------------- Parameter filters (message guards) --------------------- */}
      <form action={saveContractGuards} className="space-y-5">
        <Card title="C · Parameter filters — when to send / receive / sync (§13.8–§13.9)">
          <p className="text-xs text-[var(--ecs-muted)] mb-3">Message-level gates for each boundary — the TMC (send/receive) and ECS (expense-claim sync). <strong>All enabled conditions in a flow must hold</strong> before that message fires — e.g. a request is not sent to the TMC, and no claim is created in ECS, until it is <em>Approved</em>. Enforced in the hand-off / receive / create-claim actions; a blocked attempt is logged, not performed.</p>
          {[{ title: 'Send to TMC (outbound)', rows: outGuards }, { title: 'Receive from TMC (inbound)', rows: inGuards }, { title: 'Sync to ECS Expense Claim (TE)', rows: teGuards }].map((sec) => (
            <div key={sec.title} className="mb-4 last:mb-0">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ecs-muted)] mb-1">{sec.title}</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr><th className="th w-16 text-center">Active</th><th className="th">Condition</th><th className="th">Rule</th><th className="th">Notes</th></tr></thead>
                  <tbody>
                    {sec.rows.map((g) => (
                      <tr key={g.key} className="hover:bg-[var(--ecs-panel-2)]">
                        <td className="td text-center"><input key={String(g.enabled)} type="checkbox" name={`guard_${g.key}`} defaultChecked={g.enabled} disabled={!isAdmin} className="w-4 h-4" /></td>
                        <td className="td font-medium">{g.label}</td>
                        <td className="td text-xs">
                          {!guardEditable(g)
                            ? <span className="font-mono text-[var(--ecs-muted)]">{guardRuleText(g, g.value)}</span>
                            : g.op === 'in'
                              ? <div>
                                  <div className="font-mono text-[10px] text-[var(--ecs-muted)] mb-1">{GUARD_PARAM_LABELS[g.param]} ∈ {'{'} … {'}'}</div>
                                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                                    {GUARD_PARAM_OPTIONS[g.param].map((o) => (
                                      <label key={o} className="inline-flex items-center gap-1">
                                        <input key={`${o}:${Array.isArray(g.value) && g.value.includes(o)}`} type="checkbox" name={`guardval_${g.key}`} value={o} defaultChecked={Array.isArray(g.value) && g.value.includes(o)} disabled={!isAdmin} className="w-3.5 h-3.5" />
                                        <span className="text-[11px]">{o}</span>
                                      </label>
                                    ))}
                                  </div>
                                </div>
                              : <span className="inline-flex items-center gap-1"><span className="font-mono">{GUARD_PARAM_LABELS[g.param]} =</span>
                                  <select key={String(g.value)} name={`guardval_${g.key}`} defaultValue={typeof g.value === 'string' ? g.value : ''} disabled={!isAdmin} className="field py-1 w-48">
                                    {GUARD_PARAM_OPTIONS[g.param].map((o) => <option key={o} value={o}>{o}</option>)}
                                  </select></span>}
                        </td>
                        <td className="td text-xs text-[var(--ecs-muted)]">{g.note ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {isAdmin && <div className="flex justify-end mt-3"><button type="submit" className="btn-primary">Save parameter filters</button></div>}
        </Card>
      </form>

      {/* ---------------------- Inbound-feed requirements (canonical) ---------------------- */}
      <Card title="Receive from TMC — inbound-feed datapoints (§7.3 / §13.9)">
        <p className="text-sm text-[var(--ecs-muted)] mb-3">
          What the TMC must return on the <strong>TA-keyed booking feed</strong>, independent of any one request (the live
          preview below renders it for a chosen request). The feed lands in the <strong>Pre-Trip module</strong> and fans to
          two consumers:
        </p>
        <ul className="text-sm text-[var(--ecs-muted)] mb-4 space-y-1 list-none pl-0">
          <li className="flex items-start gap-2"><span className="pill-info mt-0.5">Pre-Trip booking</span><span>booking records (PNR / e-ticket / segments / status) + reconciliation (deviation vs approved, §6.4).</span></li>
          <li className="flex items-start gap-2"><span className="pill-warn mt-0.5">CTA → SAP</span><span>the per-charge CTA settlement posts to the SAP GL on receipt (DD-30/31) — a posting branch that does not wait for a claim.</span></li>
          <li className="flex items-start gap-2"><span className="pill-pass mt-0.5">ECS claim</span><span>booked actuals + booking reference pre-populate the expense claim / TE (§13.8), reference-only for central/CTA lines.</span></li>
        </ul>
        <div className="border border-[var(--ecs-border)] rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead><tr><th className="th">Datapoint</th><th className="th">Canonical field</th><th className="th">Consumer(s)</th><th className="th">Requirement</th><th className="th">Purpose / ECS use</th></tr></thead>
            <tbody>
              {INBOUND_FEED_SPEC.map((grp) => (
                <FragmentGroup key={grp.group} label={grp.group} cols={5}>
                  {grp.note && <tr><td className="td text-[11px] text-[var(--ecs-muted)] italic" colSpan={5}>{grp.note}</td></tr>}
                  {grp.fields.map((f) => (
                    <tr key={f.field} className="hover:bg-[var(--ecs-panel-2)] align-top">
                      <td className="td font-medium">{f.datapoint}</td>
                      <td className="td font-mono text-[11px]">{f.field}</td>
                      <td className="td"><div className="flex flex-wrap gap-1">{f.consumers.map((c) => <span key={c} className={c === 'CTA_SAP' ? 'pill-warn' : c === 'TE_CLAIM' ? 'pill-pass' : 'pill-info'}>{FEED_CONSUMER_LABEL[c]}</span>)}</div></td>
                      <td className="td whitespace-nowrap">{f.requirement === 'Mandatory' ? <span className="pill-stop">Mandatory</span> : f.requirement === 'Conditional' ? <span className="pill-warn">Conditional</span> : <span className="text-[var(--ecs-muted)]">Optional</span>}</td>
                      <td className="td text-[var(--ecs-muted)] whitespace-normal">{f.purpose}</td>
                    </tr>
                  ))}
                </FragmentGroup>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-[var(--ecs-muted)] mt-2">Canonical types: <code>src/integrations/tmc/contract.ts</code> · OBT / GDS vocabulary: <code>src/integrations/tmc/vocab.ts</code>. The same datapoints render per request below.</p>
      </Card>

      {/* --------------------------------- Live preview --------------------------------- */}
      <Card title="Live preview — governed payloads & eligibility">
        {requests.length === 0 ? (
          <Empty>No requests to preview. Create one to see the payloads and parameter filters.</Empty>
        ) : (
          <>
            <form className="flex items-end gap-2 mb-4">
              <div>
                <label className="label">Preview request</label>
                <select name="preview" defaultValue={previewId} className="field w-80">
                  {requests.map((r) => <option key={r.id} value={r.id}>{r.requestNumber}{r.isGroup ? ' (group)' : ''} · {r.status}</option>)}
                </select>
              </div>
              <button className="btn-secondary" type="submit">Load</button>
            </form>

            {/* Eligibility from the parameter filters */}
            <div className="grid md:grid-cols-3 gap-3 mb-5">
              {[{ title: 'Send to TMC', gate: outGate }, { title: 'Receive from TMC', gate: inGate }, { title: 'Sync to ECS claim', gate: teGate }].map(({ title, gate }) => (
                <div key={title} className={`rounded border p-3 ${gate?.ok ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                  <div className="text-sm font-semibold mb-1">{title}: {gate?.ok ? <span className="text-emerald-700">Eligible ✓</span> : <span className="text-amber-800">Blocked ✕</span>}</div>
                  <ul className="text-xs space-y-0.5">
                    {gate?.checks.map((c) => (
                      <li key={c.key} className="flex items-start gap-1.5">
                        <span>{c.pass ? '✓' : '✕'}</span>
                        <span className={c.pass ? 'text-[var(--ecs-muted)]' : 'text-amber-800'}>{c.rule}{!c.pass && <> — is <span className="font-mono">{c.actual}</span></>}</span>
                      </li>
                    ))}
                    {gate && gate.checks.length === 0 && <li className="text-[var(--ecs-muted)]">No active filters.</li>}
                  </ul>
                </div>
              ))}
            </div>

            <div className="mb-5">
              <h3 className="text-sm font-semibold text-[var(--ecs-navy)] mb-2">← TMC booking confirmation (inbound feed)</h3>
              <p className="text-[11px] text-[var(--ecs-muted)] mb-2">The datapoints the feed returns. The <code>charges[]</code> per-charge CTA breakdown (type · expense type · SAP tax code · GST amount) and <code>invoiceNumber</code> drive the SAP posting (DD-31). The table below is the finance-readable view; the raw JSON is the wire payload.</p>
              {inbound && (
                <div className="border border-[var(--ecs-border)] rounded overflow-hidden mb-3">
                  <table className="w-full text-xs">
                    <thead><tr><th className="th">Datapoint</th><th className="th">Value</th></tr></thead>
                    <tbody>
                      <FragmentGroup label="Booking confirmation" cols={2}>
                        <tr><td className="td">Travel Authorisation no. <span className="text-[var(--ecs-muted)]">(feed anchor)</span></td><td className="td font-medium">{inbound.authorisationNumber}</td></tr>
                        <tr><td className="td">PNR key <span className="text-[var(--ecs-muted)]">(supplier + record locator)</span></td><td className="td">{inbound.supplierCode ? `${inbound.supplierCode} · ` : ''}{inbound.pnr}</td></tr>
                        <tr><td className="td">Provider invoice no. (SAP posting reference)</td><td className="td">{inbound.invoiceNumber ?? '—'}</td></tr>
                        <tr><td className="td">Booking status <span className="text-[var(--ecs-muted)]">(OBT → ECS)</span></td><td className="td">{OBT_BOOKING_STATUS_LABEL[inbound.bookingStatus] ?? inbound.bookingStatus} <code className="text-[10px]">{inbound.bookingStatus}</code> → <span className="font-medium">{obtToEcsBookingStatus(inbound.bookingStatus)}</span></td></tr>
                        <tr><td className="td">Fulfilment channel</td><td className="td">{inbound.channel}</td></tr>
                        <tr><td className="td">Booked / ticketed at</td><td className="td">{inbound.bookedAt ?? '—'} / {inbound.ticketedAt ?? '—'}</td></tr>
                        <tr><td className="td">E-ticket numbers</td><td className="td">{inbound.ticketNumbers.join(', ') || '—'}</td></tr>
                      </FragmentGroup>
                      <FragmentGroup label="CTA settlement (DD-30)" cols={2}>
                        <tr><td className="td">CTA account · card</td><td className="td">{inbound.ctaAccountId ?? '—'} · {inbound.ctaCardRef ?? '—'}</td></tr>
                        <tr><td className="td">Settled on CTA · charge date</td><td className="td">{inbound.ctaCharged ? 'Yes' : 'No'}{inbound.ctaChargeDate ? ` · ${inbound.ctaChargeDate}` : ''}</td></tr>
                        <tr><td className="td">Statement period</td><td className="td">{inbound.statementPeriod ?? '—'}</td></tr>
                        <tr><td className="td">Fare / taxes / fees</td><td className="td">{sgd(inbound.fareSgd)} / {sgd(inbound.taxesSgd)} / {sgd(inbound.feesSgd)}</td></tr>
                      </FragmentGroup>
                      {inbound.cancellation && (
                        <FragmentGroup label="Cancellation / refund" cols={2}>
                          <tr><td className="td">Cancelled at · reason</td><td className="td">{inbound.cancellation.cancelledAt}{inbound.cancellation.reason ? ` · ${inbound.cancellation.reason}` : ''}</td></tr>
                          <tr><td className="td">Penalty retained (stays a charge)</td><td className="td">{sgd(inbound.cancellation.cancellationFeeSgd)}</td></tr>
                          <tr><td className="td">Refund to CTA (reverses the posting)</td><td className="td">{sgd(inbound.cancellation.refundSgd)}</td></tr>
                        </FragmentGroup>
                      )}
                      {inbound.reissue && (
                        <FragmentGroup label="Change / reissue" cols={2}>
                          <tr><td className="td">Reissued at · change fee</td><td className="td">{inbound.reissue.reissuedAt} · {sgd(inbound.reissue.changeFeeSgd)}</td></tr>
                          <tr><td className="td">New PNR / tickets</td><td className="td">{inbound.reissue.newPnr ?? '—'}{inbound.reissue.newTicketNumbers?.length ? ` · ${inbound.reissue.newTicketNumbers.join(', ')}` : ''}</td></tr>
                        </FragmentGroup>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              {inbound?.charges && inbound.charges.length > 0 && (
                <div className="border border-[var(--ecs-border)] rounded overflow-hidden mb-3">
                  <div className="bg-[var(--ecs-panel)] px-3 py-1.5 text-xs font-semibold text-[var(--ecs-navy)]">Per-charge CTA breakdown (DD-31) — one SAP posting line per charge</div>
                  <table className="w-full text-xs">
                    <thead><tr><th className="th">Charge</th><th className="th">Expense type</th><th className="th">GL</th><th className="th text-right">Amount (SGD)</th><th className="th">SAP tax code</th><th className="th text-right">GST (SGD)</th><th className="th">Claimable</th><th className="th">Settled against (ticket · segment · PNR)</th></tr></thead>
                    <tbody>
                      {inbound.charges.map((c, i) => { const et = expenseTypes.find((e) => e.id === c.expenseTypeId); return (
                        <tr key={i} className="hover:bg-[var(--ecs-panel-2)]">
                          <td className="td">{c.type}</td><td className="td">{et?.name ?? c.expenseTypeId}</td><td className="td">{et?.glAccount ?? '—'}</td>
                          <td className="td text-right whitespace-nowrap">{sgd(c.amountSgd)}</td><td className="td">{c.gstCode}</td><td className="td text-right whitespace-nowrap">{sgd(c.gstAmountSgd)}</td>
                          <td className="td">{c.type === 'FEE' ? (c.gstClaimable ? 'Yes (I9)' : 'No (P9)') : '—'}</td>
                          <td className="td font-mono text-[10px] whitespace-nowrap">{[c.ticketNumber, c.segmentRef, c.pnr].filter(Boolean).join(' · ') || '—'}</td>
                        </tr>
                      ); })}
                    </tbody>
                  </table>
                </div>
              )}
              {inbound?.segments && inbound.segments.length > 0 && (
                <div className="border border-[var(--ecs-border)] rounded overflow-hidden mb-3">
                  <div className="bg-[var(--ecs-panel)] px-3 py-1.5 text-xs font-semibold text-[var(--ecs-navy)]">Booked segments — segment → PNR → TA trace</div>
                  <div className="px-3 py-1 text-[10px] text-[var(--ecs-muted)] border-b border-[var(--ecs-border)]">Each segment carries its own ref and the PNR it sits under, and air segments carry the GDS status + e-ticket/coupon — so finance can walk a charge back to the exact flight, PNR and the TA <code>{inbound.authorisationNumber}</code> that authorised it.</div>
                  <table className="w-full text-xs">
                    <thead><tr><th className="th">Segment ref</th><th className="th">Type</th><th className="th">Route / city</th><th className="th">Booked class</th><th className="th">GDS status</th><th className="th">Ticket · coupon</th><th className="th">PNR · supplier</th><th className="th">Dates</th><th className="th text-right">Amount (SGD)</th></tr></thead>
                    <tbody>
                      {inbound.segments.map((s, i) => (
                        <tr key={i} className="hover:bg-[var(--ecs-panel-2)]">
                          <td className="td font-mono text-[10px]">{s.segmentRef ?? '—'}</td>
                          <td className="td">{s.type}</td><td className="td">{s.type === 'AIR' ? `${s.origin ?? ''} → ${s.destination ?? ''}` : (s.city ?? '')}</td>
                          <td className="td">{s.bookedClass ?? '—'}</td>
                          <td className="td whitespace-nowrap">{s.segmentStatus ? <span title={SEGMENT_STATUS_LABEL[s.segmentStatus] ?? ''}><code className="text-[10px]">{s.segmentStatus}</code> {SEGMENT_STATUS_LABEL[s.segmentStatus] ?? ''}</span> : '—'}</td>
                          <td className="td font-mono text-[10px] whitespace-nowrap">{s.type === 'AIR' ? `${s.ticketNumber ?? '—'}${s.couponNumber ? ` · c${s.couponNumber}` : ''}` : (s.confirmationNo ?? '—')}</td>
                          <td className="td font-mono text-[10px] whitespace-nowrap">{s.pnr ?? inbound.pnr}{s.supplierCode ? ` · ${s.supplierCode}` : ''}</td>
                          <td className="td whitespace-nowrap">{s.departDate ?? '—'}{s.arriveDate ? ` → ${s.arriveDate}` : ''}</td>
                          <td className="td text-right whitespace-nowrap">{s.type === 'AIR' ? '—' : sgd(s.amountSgd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <details className="text-xs">
                <summary className="cursor-pointer text-[var(--ecs-muted)]">Raw JSON (wire payload)</summary>
                <pre className="text-xs bg-[var(--ecs-panel-2)] border border-[var(--ecs-border)] rounded p-3 overflow-x-auto max-h-[28rem] mt-2">{JSON.stringify(inbound, null, 2)}</pre>
              </details>
            </div>

            <div className="grid lg:grid-cols-2 gap-5 items-start">
              <div>
                <h3 className="text-sm font-semibold text-[var(--ecs-navy)] mb-2">→ TMC booking instruction</h3>
                <pre className="text-xs bg-[var(--ecs-panel-2)] border border-[var(--ecs-border)] rounded p-3 overflow-x-auto max-h-[28rem]">{JSON.stringify(outbound, null, 2)}</pre>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[var(--ecs-navy)] mb-2">→ Expense claim pre-population</h3>
                <div className="border border-[var(--ecs-border)] rounded overflow-hidden">
                  <table className="w-full text-xs">
                    <thead><tr><th className="th">Claim field / line</th><th className="th">Value</th><th className="th">Treatment</th></tr></thead>
                    <tbody>
                      {prep?.header.map((h, i) => (
                        <tr key={`h${i}`} className="hover:bg-[var(--ecs-panel-2)]"><td className="td">{h.label}</td><td className="td">{h.value}</td><td className="td"><TreatmentPill treatment={h.treatment} /></td></tr>
                      ))}
                      {prep?.lines.map((l, i) => (
                        <tr key={`l${i}`} className="hover:bg-[var(--ecs-panel-2)] font-medium"><td className="td">{l.label}</td><td className="td">approved {l.approvedSgd.toLocaleString('en-SG', { style: 'currency', currency: 'SGD' })}</td><td className="td"><TreatmentPill treatment={l.treatment} /></td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-[var(--ecs-muted)] mt-2">{prep?.note}</p>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

/** A labelled sub-header row spanning the table, grouping the fields below it. */
function FragmentGroup({ label, cols, children }: { label: string; cols: number; children: React.ReactNode }) {
  return (
    <>
      <tr><td colSpan={cols} className="td bg-[var(--ecs-panel)] text-[11px] font-semibold uppercase tracking-wide text-[var(--ecs-muted)]">{label}</td></tr>
      {children}
    </>
  );
}

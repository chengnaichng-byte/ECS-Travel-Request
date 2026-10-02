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
import { prepopulateClaim } from '@/modules/te/prepopulate';
import { CONTRACT_FIELDS, TE_TREATMENT_OPTIONS, GUARD_PARAM_OPTIONS, GUARD_PARAM_LABELS, guardEditable, CONTRACT_VERSION } from '@/config/integrationContracts';
import { saveContractSettings, saveContractGuards } from '@/app/actions';
import { REQUEST_STATUS, ROLE } from '@/shared/enums';
import { PageTitle, Card, Empty } from '@/components/ui';
import { TreatmentPill } from '@/components/StatusPill';

export const dynamic = 'force-dynamic';

const TMC_GROUPS = ['Booking header', 'Itinerary', 'Accommodation'];
const TE_GROUPS = ['Claim header', 'Claim lines', 'Claim actuals'];

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

// TR-09 Charging & Allocation — ECS-format (§17). Estimated cost lines are shown first;
// charging then uses the ECS cascade (Company Code → Business Area → CC/WBS → Account) with
// an optional cost allocation (at claim level or per expense item) and computed Accounting
// Entries. Reuses ECS charging masters and the traveller's profile default account. The
// effective split is persisted to ChargingAllocation, which drives approval routing (§13.14).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadRequest, type FullRequest } from '@/modules/pretrip/queries';
import { saveCharging } from '@/modules/pretrip/actions';
import { getSettings } from '@/modules/pretrip/settings';
import { currentPersonaId } from '@/shared/session';
import { canEditRequest } from '@/modules/pretrip/guards';
import { chargingCodes, companyCodes, businessAreas } from '@/data/charging';
import { expenseTypes } from '@/data/expenseTypes';
import { EcsReference, EcsIdentity } from '@/shared/ecs/services';
import { computeSummary, fmtSgd } from '@/modules/pretrip/pricing';
import { EXPENSE_CATEGORY } from '@/shared/enums';
import { ChargingAccountEditor, type AccountOpt, type CostLineX } from '@/components/ChargingAccountEditor';
import { Card, Stepper, Empty } from '@/components/ui';

export const dynamic = 'force-dynamic';

function detailOf(e: FullRequest['expenses'][number]): string {
  if (e.category === EXPENSE_CATEGORY.Airfare) return `${e.originCode ?? ''} → ${e.destCode ?? ''} · ${EcsReference.travelClass(e.proposedClassId ?? '')?.name ?? ''}`;
  if (e.accommodation) return `${EcsReference.city(e.accommodation.city)?.name ?? e.accommodation.city} · ${e.accommodation.nights}n`;
  if (e.oda) return `${EcsReference.country(e.oda.country)?.name ?? e.oda.country} · ${e.oda.eligibleDays} days @ ${fmtSgd(e.oda.dailyRate)}/day`;
  return e.notes ?? '';
}

export default async function ChargingStep({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const req = await loadRequest(id);
  if (!req) notFound();
  const settings = await getSettings();
  const canEdit = canEditRequest(await currentPersonaId(), req);
  const summary = computeSummary(req.expenses, settings.approvalAmountBasis);

  const defaultAccount = EcsIdentity.employee(req.travellerId)?.defaultChargingCode ?? chargingCodes[0]?.code ?? '';
  const accounts: AccountOpt[] = chargingCodes.map((c) => ({
    code: c.code, name: c.name, type: c.type, companyCode: c.companyCode, businessArea: c.businessArea,
    research: c.isResearch, crossCharge: !!c.crossCharge, closed: c.active === false,
  }));
  const etOpts = expenseTypes.map((e) => ({ id: e.id, name: e.name, gl: e.glAccount, gst: e.gstCode }));
  const lines: CostLineX[] = req.expenses.map((e) => ({
    id: e.id, typeId: e.expenseTypeId,
    typeName: EcsReference.expenseType(e.expenseTypeId)?.name ?? e.category,
    net: Math.max(e.sgdAmount - e.sponsorSgd, 0),
  }));

  // Derive the editor's initial mode from the stored chargingMode (migrating old values).
  const stored = req.chargingMode;
  const initialMode: 'MAIN' | 'CLAIM' | 'ITEM' =
    stored === 'ITEM' || stored === 'LINE' ? 'ITEM'
    : stored === 'CLAIM' ? 'CLAIM'
    : stored === 'MAIN' ? 'MAIN'
    : req.allocations.length > 1 ? 'CLAIM' : 'MAIN';
  const mainAlloc = req.allocations.find((a) => a.isMain) ?? req.allocations[0];
  const initialMain = mainAlloc?.chargingCode ?? defaultAccount;
  const initialRows = req.allocations.map((a) => ({ ba: a.businessArea ?? '', code: a.chargingCode, io: a.internalOrder ?? '', pct: a.percent }));
  const initialLineMap: Record<string, string> = {};
  for (const e of req.expenses) if (e.chargingCode) initialLineMap[e.id] = e.chargingCode;

  return (
    <div>
      <Stepper id={id} active="charging" />
      {!canEdit && <div className="card p-3 mb-4 text-sm text-amber-900 bg-amber-50 border-amber-200">Read-only view — your role cannot edit this request&apos;s charging.</div>}

      <Card title={`Estimated Cost Lines (${req.expenses.length})`} className="mb-5">
        {req.expenses.length === 0 ? <Empty>No estimate lines yet — add airfare, accommodation and ODA on the Estimates step.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">Type</th><th className="th">Detail</th><th className="th text-right">Gross (SGD)</th><th className="th text-right">Sponsor (SGD)</th><th className="th text-right">NTU-funded (SGD)</th></tr></thead>
              <tbody>
                {req.expenses.map((e) => (
                  <tr key={e.id} className="hover:bg-[var(--ecs-panel-2)]">
                    <td className="td font-medium">{EcsReference.expenseType(e.expenseTypeId)?.name ?? e.category}</td>
                    <td className="td text-xs text-[var(--ecs-muted)]">{detailOf(e)}</td>
                    <td className="td text-right whitespace-nowrap">{fmtSgd(e.sgdAmount)}</td>
                    <td className="td text-right whitespace-nowrap">{e.sponsorSgd > 0 ? `− ${fmtSgd(e.sponsorSgd)}` : '—'}</td>
                    <td className="td text-right whitespace-nowrap font-medium">{fmtSgd(Math.max(e.sgdAmount - e.sponsorSgd, 0))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className="td" colSpan={2}>Estimated NTU-funded cost</td>
                  <td className="td text-right">{fmtSgd(summary.gross)}</td>
                  <td className="td text-right">{summary.sponsorship > 0 ? `− ${fmtSgd(summary.sponsorship)}` : '—'}</td>
                  <td className="td text-right">{fmtSgd(summary.ntuFunded)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <ChargingAccountEditor
        action={saveCharging.bind(null, id)}
        canEdit={canEdit}
        total={summary.ntuFunded}
        companyCodes={companyCodes.map((c) => ({ code: c.code, name: c.name }))}
        businessAreas={businessAreas.map((b) => ({ code: b.code, name: b.name, companyCode: b.companyCode }))}
        accounts={accounts}
        expenseTypes={etOpts}
        lines={lines}
        defaultAccount={defaultAccount}
        initialMode={initialMode}
        initialMain={initialMain}
        initialRows={initialRows}
        initialLineMap={initialLineMap}
        submitLabel="Save &amp; run policy review →"
        entriesTitle="Allocation Outcome"
      />

      <div className="mt-5">
        <Link href={`/requests/${id}/estimates`} className="btn-secondary">← Back to estimates</Link>
      </div>
    </div>
  );
}

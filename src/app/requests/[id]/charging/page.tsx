// TR-09 Charging & Allocation — ECS-consistent experience. The estimated cost lines are
// shown first; charging can then be allocated either as one whole-request split or per
// cost line (cross-charging), with the computed cost allocation per charging account shown
// live. Reuses ECS charging masters (Company Code, Business Area, CC/WBS) and the
// traveller's profile default charging account (§7/§13.18). Submission is blocked unless
// allocations total 100% (AC06).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadRequest, type FullRequest } from '@/modules/pretrip/queries';
import { saveCharging } from '@/modules/pretrip/actions';
import { getSettings } from '@/modules/pretrip/settings';
import { currentPersonaId } from '@/shared/session';
import { canEditRequest } from '@/modules/pretrip/guards';
import { chargingCodes } from '@/data/charging';
import { EcsReference, EcsIdentity } from '@/shared/ecs/services';
import { computeSummary, fmtSgd } from '@/modules/pretrip/pricing';
import { EXPENSE_CATEGORY } from '@/shared/enums';
import { ChargingEditor, type CodeOption, type CostLine } from '@/components/ChargingEditor';
import { Card, Stepper, Empty } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ChargingStep({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const req = await loadRequest(id);
  if (!req) notFound();
  const settings = await getSettings();
  const canEdit = canEditRequest(await currentPersonaId(), req);
  const amountMode = settings.chargingSplitMode === 'AMOUNT'; // §17
  const summary = computeSummary(req.expenses, settings.approvalAmountBasis);

  // §7 profile default charging account (derived from the traveller's department / profile).
  const defaultCode = EcsIdentity.employee(req.travellerId)?.defaultChargingCode ?? chargingCodes[0]?.code ?? '';

  // Charging masters as plain options for the client editor.
  const codes: CodeOption[] = chargingCodes.map((c) => ({
    code: c.code, name: c.name, type: c.type,
    deptName: EcsIdentity.department(c.departmentId)?.name ?? c.departmentId,
    ba: c.businessArea, research: c.isResearch, crossCharge: !!c.crossCharge, closed: c.active === false,
  }));

  // Cost lines (read-only summary + per-line charging targets).
  const lineDetail = (e: FullRequest['expenses'][number]): string => {
    if (e.category === EXPENSE_CATEGORY.Airfare) return `${e.originCode ?? ''} → ${e.destCode ?? ''} · ${EcsReference.travelClass(e.proposedClassId ?? '')?.name ?? ''}`;
    if (e.accommodation) return `${EcsReference.city(e.accommodation.city)?.name ?? e.accommodation.city} · ${e.accommodation.nights}n`;
    if (e.oda) return `${EcsReference.country(e.oda.country)?.name ?? e.oda.country} · ${e.oda.eligibleDays} days @ ${fmtSgd(e.oda.dailyRate)}/day`;
    return e.notes ?? '';
  };
  const lines: CostLine[] = req.expenses.map((e) => ({
    id: e.id,
    type: EcsReference.expenseType(e.expenseTypeId)?.name ?? e.category,
    detail: lineDetail(e),
    netSgd: Math.max(e.sgdAmount - e.sponsorSgd, 0),
  }));

  const initialRequestRows = req.allocations.map((a) => ({
    chargingCode: a.chargingCode,
    value: amountMode ? (a.amountSgd != null ? String(a.amountSgd) : '') : String(a.percent),
  }));
  const initialLineMap: Record<string, string> = {};
  for (const e of req.expenses) if (e.chargingCode) initialLineMap[e.id] = e.chargingCode;

  return (
    <div>
      <Stepper id={id} active="charging" />
      {!canEdit && <div className="card p-3 mb-4 text-sm text-amber-900 bg-amber-50 border-amber-200">Read-only view — your role cannot edit this request&apos;s charging.</div>}

      {/* Cost lines shown first (above the charging & cost allocation section). */}
      <Card title={`Estimated Cost Lines (${req.expenses.length})`} className="mb-5">
        {req.expenses.length === 0 ? <Empty>No estimate lines yet — add airfare, accommodation and ODA on the Estimates step.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">Type</th><th className="th">Detail</th><th className="th text-right">Gross (SGD)</th><th className="th text-right">Sponsor (SGD)</th><th className="th text-right">NTU-funded (SGD)</th></tr></thead>
              <tbody>
                {req.expenses.map((e) => (
                  <tr key={e.id} className="hover:bg-[var(--ecs-panel-2)]">
                    <td className="td font-medium">{EcsReference.expenseType(e.expenseTypeId)?.name ?? e.category}</td>
                    <td className="td text-xs text-[var(--ecs-muted)]">{lineDetail(e)}</td>
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

      <ChargingEditor
        action={saveCharging.bind(null, id)}
        canEdit={canEdit}
        amountMode={amountMode}
        ntuFunded={summary.ntuFunded}
        codes={codes}
        defaultCode={defaultCode}
        initialMode={req.chargingMode === 'LINE' ? 'LINE' : 'REQUEST'}
        lines={lines}
        initialRequestRows={initialRequestRows}
        initialLineMap={initialLineMap}
      />

      <div className="mt-5">
        <Link href={`/requests/${id}/estimates`} className="btn-secondary">← Back to estimates</Link>
      </div>
    </div>
  );
}

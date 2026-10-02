// Charging & cost-object breakdown — shows each CC/WBS the request is charged to with
// Company Code, Business Area, Charging Account, research flag, funding owner and the
// SGD amount apportioned from the estimated NTU-funded cost. Lets an approver see
// exactly what lands on each department CC vs a research WBS (§2, §13.14).
import { EcsCharging, EcsIdentity } from '@/shared/ecs/services';
import { fmtSgd } from '@/modules/pretrip/pricing';
import { Card } from './ui';
import type { FullRequest } from '@/modules/pretrip/queries';

export function ChargingBreakdown({ req, amount }: { req: FullRequest; amount: number }) {
  const rows = req.allocations.map((a) => {
    const code = EcsCharging.code(a.chargingCode);
    return {
      id: a.id,
      code: a.chargingCode,
      name: code?.name ?? '—',
      type: code?.type ?? a.chargingType,
      company: code?.companyCode ?? a.companyCode ?? '—',
      ba: code?.businessArea ?? a.businessArea ?? '—',
      dept: EcsIdentity.department(code?.departmentId ?? '')?.name ?? '—',
      research: code?.isResearch ?? a.isResearch,
      fundingOwner: code?.fundingOwnerId ? EcsIdentity.employee(code.fundingOwnerId)?.name : undefined,
      crossCharge: code?.crossCharge,
      percent: a.percent,
      amount: (amount * a.percent) / 100,
    };
  });
  const total = rows.reduce((s, r) => s + r.amount, 0);

  return (
    <Card title="Charging & Cost Objects">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th className="th">CC / WBS</th><th className="th">Charging account</th><th className="th">Type</th>
              <th className="th">Company / BA</th><th className="th">Department</th>
              <th className="th text-right">Share</th><th className="th text-right">Amount (SGD)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-[var(--ecs-panel-2)]">
                <td className="td font-medium whitespace-nowrap">
                  {r.code}
                  {r.research && <span className="pill-warn ml-1">Research WBS</span>}
                  {r.crossCharge && <span className="pill-info ml-1">Cross-charge</span>}
                </td>
                <td className="td">{r.name}{r.fundingOwner && <div className="text-xs text-[var(--ecs-muted)]">Funding owner: {r.fundingOwner}</div>}</td>
                <td className="td">{r.type}</td>
                <td className="td whitespace-nowrap">{r.company} · {r.ba}</td>
                <td className="td">{r.dept}</td>
                <td className="td text-right">{r.percent}%</td>
                <td className="td text-right whitespace-nowrap font-medium">{fmtSgd(r.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold text-[var(--ecs-navy)]">
              <td className="td" colSpan={5}>Total estimated NTU-funded cost</td>
              <td className="td text-right">{req.allocations.reduce((s, a) => s + a.percent, 0)}%</td>
              <td className="td text-right whitespace-nowrap">{fmtSgd(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-[var(--ecs-muted)] mt-2">Amounts apportion the estimated NTU-funded cost by allocation share. Research WBS lines route via the Research DOA when configured; the highest-share department derives the approving DOA (§13.14).</p>
    </Card>
  );
}

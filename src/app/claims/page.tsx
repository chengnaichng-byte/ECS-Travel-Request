// My Travel Expense Claims — the acting persona's prototype TE claims (the claims this Pre-Trip module
// holds, distinct from the external ECS claim system). A reliable in-prototype entry into the claim
// screens; a Travel/System Administrator sees every claim. Also links to the TMC-transition picker.
import Link from 'next/link';
import { prisma } from '@/shared/db';
import { currentPersonaId } from '@/shared/session';
import { EcsIdentity, EcsReference } from '@/shared/ecs/services';
import { fmtSgd } from '@/modules/te/prepopulate';
import { createExceptionClaim } from '@/modules/te/actions';
import { Card, Empty } from '@/components/ui';

export const dynamic = 'force-dynamic';
const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : '—');

export default async function ClaimsIndexPage() {
  const persona = await currentPersonaId();
  const isAdmin = EcsIdentity.hasRole(persona, 'TRAVEL_ADMIN') || EcsIdentity.hasRole(persona, 'SYSTEM_ADMIN');
  const claims = await prisma.travelExpenseClaim.findMany({
    where: isAdmin ? {} : { claimantId: persona },
    include: { request: { select: { requestNumber: true, destCity: true } }, lines: { select: { actualSgd: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const total = (ls: { actualSgd: number }[]) => ls.reduce((s, l) => s + l.actualSgd, 0);

  return (
    <div className="w-full space-y-5">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--ecs-border)] pb-3">
        <h1 className="text-xl font-bold text-[var(--ecs-navy)]">My Travel Expense Claims {isAdmin && <span className="font-normal text-[var(--ecs-muted)]">· all (administrator)</span>}</h1>
        <div className="ml-auto flex items-center gap-2">
          <form action={createExceptionClaim}><button className="btn-secondary" title="Raise a claim directly, with no pre-trip Travel Request (exception situation)">+ Claim without a TR (exception)</button></form>
          <Link href="/claims/transition" className="btn-ghost">TMC transition claim →</Link>
        </div>
      </div>
      <p className="text-xs text-[var(--ecs-muted)] -mt-2">The expense claims this Pre-Trip prototype holds. A claim is created from a booked, approved trip (open the trip from the dashboard), directly as an <strong>exception</strong> claim with no Travel Request, or from a pre-go-live PNR via the TMC transition picker.</p>

      <Card title={`Claims (${claims.length})`}>
        {claims.length === 0 ? (
          <Empty>No expense claims yet. Create one from an approved, booked trip on the <Link href="/dashboard" className="underline">dashboard</Link>, or claim a legacy PNR from the <Link href="/claims/transition" className="underline">TMC transition picker</Link>.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>
                <th className="th">Claim</th><th className="th">From</th><th className="th">Destination</th>
                <th className="th">Claimant</th><th className="th text-right">Total</th><th className="th">Status</th><th className="th"></th>
              </tr></thead>
              <tbody>
                {claims.map((c) => (
                  <tr key={c.id} className="hover:bg-[var(--ecs-panel-2)]">
                    <td className="td font-medium whitespace-nowrap">{c.claimNumber}{c.legacyPnr && <span className="ml-2 inline-block rounded px-1.5 py-0.5 text-xs bg-[var(--ecs-panel-2)] text-[var(--ecs-muted)]">Legacy</span>}</td>
                    <td className="td whitespace-nowrap font-mono text-xs">{c.request?.requestNumber ?? (c.legacyPnr ? `PNR ${c.legacyPnr}` : '—')}</td>
                    <td className="td">{EcsReference.city(c.request?.destCity ?? '')?.name ?? c.request?.destCity ?? '—'}</td>
                    <td className="td">{EcsIdentity.employee(c.claimantId)?.name ?? c.claimantId}</td>
                    <td className="td text-right whitespace-nowrap">{fmtSgd(total(c.lines))}</td>
                    <td className="td"><span className={c.status === 'Approved' ? 'pill-pass' : c.status.startsWith('Pending') ? 'pill-warn' : c.status === 'SentBack' ? 'pill-exc' : 'pill-info'}>{c.status}</span></td>
                    <td className="td text-right"><Link href={`/claims/${c.id}`} className="btn-ghost text-xs">Open →</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

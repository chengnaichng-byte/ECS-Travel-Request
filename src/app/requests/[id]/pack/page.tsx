// §24 Approval Pack — a print-optimised one-page summary of the approved Travel Request
// for email / audit / the TMC / the claim. "Download PDF" opens this and the browser's
// Print → Save as PDF produces the file (no server-side PDF dependency in the prototype).
import { notFound } from 'next/navigation';
import { loadRequest } from '@/modules/pretrip/queries';
import { getSettings } from '@/modules/pretrip/settings';
import { computeSummary, fmtSgd } from '@/modules/pretrip/pricing';
import { EcsIdentity, EcsReference, EcsCharging } from '@/shared/ecs/services';
import { travellerName, travellerTitle, isGuestRequest } from '@/modules/pretrip/traveller';
import { sharedLegs } from '@/modules/pretrip/group';
import { POLICY_OUTCOME } from '@/shared/enums';
import { PrintButton } from '@/components/PrintButton';

export const dynamic = 'force-dynamic';
const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : '—');

export default async function ApprovalPack({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const req = await loadRequest(id);
  if (!req) notFound();
  const settings = await getSettings();
  const summary = computeSummary(req.expenses, settings.approvalAmountBasis);
  const exceptions = req.policyChecks.filter((c) => c.outcome === POLICY_OUTCOME.Exception);
  const legs = sharedLegs(req);

  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div style={{ display: 'flex', gap: 8, fontSize: 13, padding: '2px 0' }}>
      <div style={{ width: 190, color: '#555' }}>{k}</div>
      <div style={{ flex: 1 }}>{v ?? '—'}</div>
    </div>
  );

  return (
    <div className="pack">
      <style>{`
        @media print { .no-print { display: none !important; } @page { margin: 14mm; } }
        .pack { max-width: 820px; margin: 0 auto; background: #fff; color: #111; }
        .pack h1 { font-size: 20px; color: #1B1C62; margin: 0 0 2px; }
        .pack h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: #1B1C62; border-bottom: 2px solid #D71440; padding-bottom: 3px; margin: 18px 0 8px; }
        .pack table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .pack th, .pack td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #e5e5e5; }
        .pack td.r, .pack th.r { text-align: right; }
      `}</style>

      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', margin: '0 0 14px' }}>
        <a href={`/requests/${id}`} className="btn-ghost">← Back to request</a>
        <PrintButton />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <h1>Travel Authorisation — Approval Pack</h1>
          <div style={{ fontSize: 13, color: '#555' }}>{EcsIdentity.entity().name} · ECS Pre-Trip</div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 13 }}>
          <div><strong>{req.requestNumber}</strong></div>
          <div>TA: {req.authorisationNo ?? '—'}</div>
          <div>Status: {req.status}</div>
        </div>
      </div>

      <h2>Traveller</h2>
      <Row k="Traveller" v={<>{travellerName(req)}{isGuestRequest(req) ? ' (guest / non-employee)' : ''}</>} />
      <Row k={isGuestRequest(req) ? 'Affiliation' : 'Title / Position'} v={travellerTitle(req)} />
      <Row k="Department" v={EcsIdentity.department(req.departmentId ?? '')?.name} />
      <Row k="Requestor" v={EcsIdentity.employee(req.requestorId)?.name} />

      <h2>Trip</h2>
      <Row k="Purpose" v={EcsReference.travelPurpose(req.purposeId ?? '')?.name} />
      <Row k="Destination" v={`${EcsReference.city(req.destCity ?? '')?.name ?? '—'}, ${EcsReference.country(req.destCountry ?? '')?.name ?? ''}`} />
      <Row k="Official dates" v={`${d(req.startDate)} → ${d(req.endDate)}`} />
      {(req.eventStartDate || req.eventEndDate) && <Row k="Event dates" v={`${d(req.eventStartDate)} → ${d(req.eventEndDate)}`} />}
      {req.invitationRef && <Row k="Invitation ref" v={req.invitationRef} />}
      <Row k="Travel class" v={EcsReference.travelClass(req.travelClassId ?? '')?.name} />
      <Row k="Booking method" v={req.bookingMethod ?? '—'} />

      {legs.length > 0 && (
        <>
          <h2>Itinerary</h2>
          <table>
            <thead><tr><th>Leg</th><th>From</th><th>To</th><th>Depart</th><th>Mode</th></tr></thead>
            <tbody>
              {legs.map((l, i) => (
                <tr key={l.id}><td>{i + 1}{l.isPersonal ? ' (personal)' : ''}</td><td>{l.originCode}</td><td>{l.destCode}</td><td>{d(l.departDate)}</td><td>{l.transportMode}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2>Estimated Costs</h2>
      <table>
        <tbody>
          {req.expenses.map((e) => (
            <tr key={e.id}><td>{EcsReference.expenseType(e.expenseTypeId)?.name ?? e.category}</td><td className="r">{fmtSgd(e.sgdAmount)}</td></tr>
          ))}
          <tr><td style={{ fontWeight: 600 }}>Estimated NTU-funded</td><td className="r" style={{ fontWeight: 600 }}>{fmtSgd(summary.ntuFunded)}</td></tr>
          <tr><td>Approval amount ({settings.approvalAmountBasis})</td><td className="r">{fmtSgd(summary.approvalAmount)}</td></tr>
        </tbody>
      </table>

      <h2>Charging</h2>
      <table>
        <thead><tr><th>Cost object</th><th>Business area</th><th className="r">Share</th></tr></thead>
        <tbody>
          {req.allocations.map((a) => (
            <tr key={a.id}><td>{a.chargingCode} — {EcsCharging.code(a.chargingCode)?.name ?? ''}</td><td>{a.businessArea ?? '—'}</td><td className="r">{a.percent}%</td></tr>
          ))}
        </tbody>
      </table>

      <h2>Approval Trail</h2>
      <table>
        <thead><tr><th>Seq</th><th>Role</th><th>Approver</th><th>Decision</th><th>When</th></tr></thead>
        <tbody>
          {req.approvalSteps.map((s) => (
            <tr key={s.id}><td>{s.seq}</td><td>{s.roleType}</td><td>{EcsIdentity.employee(s.approverId ?? '')?.name ?? '—'}</td><td>{s.status}</td><td>{s.decidedAt ? d(s.decidedAt) : '—'}</td></tr>
          ))}
        </tbody>
      </table>

      {exceptions.length > 0 && (
        <>
          <h2>Approved Policy Exceptions</h2>
          <ul style={{ fontSize: 13, margin: 0, paddingLeft: 18 }}>
            {exceptions.map((c) => <li key={c.id}>{c.label} — {c.detail}</li>)}
          </ul>
        </>
      )}

      <p style={{ fontSize: 11, color: '#777', marginTop: 20 }}>
        Generated from the ECS Pre-Trip prototype. Approval, entitlements and declarations derive from the traveller (§13.13). This pack reflects the request at the time of printing.
      </p>
    </div>
  );
}

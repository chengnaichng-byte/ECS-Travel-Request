// §4.8 High-risk travel advisory — shown to the traveller (review) and approver (detail)
// when a request's destination is designated high-risk.
import { highRiskDestinationsForRequest } from '@/modules/pretrip/risk';
import type { FullRequest } from '@/modules/pretrip/queries';

export function HighRiskAdvisory({ req }: { req: FullRequest }) {
  const hits = highRiskDestinationsForRequest(req);
  if (hits.length === 0) return null;
  return (
    <div className="card p-4 mt-5 border-red-300 bg-red-50">
      <div className="flex items-center gap-2 text-[var(--ecs-red)] font-semibold text-sm">
        <span>⚠</span> High-Risk Travel Advisory (§4.8)
      </div>
      <ul className="mt-2 space-y-2">
        {hits.map((h) => (
          <li key={h.countryCode} className="text-sm text-red-900">
            <span className="font-semibold">{h.name}</span>{' '}
            <span className="pill-exc align-middle">{h.riskLevel}</span>
            <div className="text-[13px] text-red-800 mt-0.5">{h.advisory}</div>
            <div className="text-[11px] text-red-700/80 mt-0.5">Source: {h.source}</div>
          </li>
        ))}
      </ul>
      <p className="text-xs text-red-800 mt-2">Traveller and approver acknowledgements are mandatory; the Risk Management Office is notified on submission.</p>
    </div>
  );
}

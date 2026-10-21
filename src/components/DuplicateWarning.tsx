// §13.x Upfront duplicate / overlap warning. Surfaced on every editable wizard step (Trip →
// Policy) once the official dates are known, so the traveller is alerted as early as possible —
// not only at the Submit gate. A true duplicate (same traveller + overlapping dates + same
// destination) is a hard block at submission; a date clash with a different destination is a
// softer notice. This component is the early-warning surface; the hard enforcement still lives
// on the Submit step (submission is disabled while a blocking duplicate remains).
import Link from 'next/link';
import { findDuplicateRequests } from '@/modules/pretrip/duplicates';
import type { FullRequest } from '@/modules/pretrip/queries';

export async function DuplicateWarning({ req }: { req: FullRequest }) {
  const duplicates = await findDuplicateRequests(req);
  if (duplicates.length === 0) return null;
  const blocking = duplicates.filter((d) => d.sameDestination);
  const clashes = duplicates.filter((d) => !d.sameDestination);
  return (
    <>
      {blocking.length > 0 && (
        <div className="card p-3 mb-4 text-sm text-red-800 bg-red-50 border-red-200">
          <b>Duplicate travel request.</b> An active request already covers this trip — this will block submission until you cancel or amend it:
          <ul className="list-disc pl-5 mt-1">
            {blocking.map((d) => (
              <li key={d.requestNumber}><Link href={`/requests?find=${d.requestNumber}`} className="underline">{d.requestNumber}</Link> ({d.status}) — {d.destination}, {d.dates}</li>
            ))}
          </ul>
        </div>
      )}
      {clashes.length > 0 && (
        <div className="card p-3 mb-4 text-sm text-amber-900 bg-amber-50 border-amber-200">
          <b>Overlapping dates.</b> This traveller has another active request with overlapping dates (different destination) — check this is not a double-booking: {clashes.map((d) => `${d.requestNumber} (${d.destination}, ${d.dates})`).join('; ')}.
        </div>
      )}
    </>
  );
}

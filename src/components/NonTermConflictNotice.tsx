// §13.x Proactive prompt for the research → non-research conflict. When the charging account is
// changed so the trip is no longer research-funded but a non-term research declaration still stands,
// this amber notice appears immediately on the Charging and Review steps (not only as a submit block),
// with a one-click confirm that removes the now-invalid declaration and detaches its approval email.
import { nonTermResearchEligible } from '@/modules/pretrip/nonTerm';
import { clearNonTermDeclaration } from '@/modules/pretrip/actions';
import type { FullRequest } from '@/modules/pretrip/queries';

export function NonTermConflictNotice({ req }: { req: FullRequest }) {
  // Only when a declaration stands AND the charging is no longer research-funded.
  if (!req.nonTermDeclared || nonTermResearchEligible(req)) return null;
  return (
    <div className="card p-4 mb-4 border-amber-300 bg-amber-50">
      <div className="text-sm text-amber-900">
        <b>Travel Classification changed to Non-Research.</b> This trip is now charged to a non-research
        account, so the <b>non-term research declaration</b> you made (and its attached offline-approval
        email) no longer applies. Remove it to keep the request consistent — or charge the trip back to a
        research account on the Charging step to keep the declaration.
      </div>
      <form action={clearNonTermDeclaration.bind(null, req.id)} className="mt-3">
        <button className="btn-danger text-sm">Remove the non-term declaration</button>
      </form>
    </div>
  );
}

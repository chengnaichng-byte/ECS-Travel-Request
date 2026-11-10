// §GRP-7 (agreed rule 11 November 2026) who an expense claim may be raised for, and by whom.
// Only the traveller themselves, or their delegate, may raise a claim for that traveller's share;
// a delegate-raised claim is recorded as the TRAVELLER's claim. A group requestor who is neither a
// member nor a delegate cannot claim for another member. `members` are the employee (claimable)
// members of the request; `delegablePrincipals` is the set the actor may act for (reusing the
// existing create-delegation master, per the agreed approach).
export function resolveClaimTraveller(
  members: (string | null | undefined)[],
  persona: string,
  delegablePrincipals: string[],
): { travellerId: string | null; onBehalf: boolean } {
  const ms = members.filter((m): m is string => !!m);
  if (ms.includes(persona)) return { travellerId: persona, onBehalf: false };
  const principal = ms.find((m) => delegablePrincipals.includes(m));
  return principal ? { travellerId: principal, onBehalf: true } : { travellerId: null, onBehalf: false };
}

// §13.x Non-term research travel — attestation + offline-approval e-mail evidence. Mirrors the
// emergency lane's email-approval pattern (see emergency.ts). When a research-funded (research WBS)
// trip takes place in non-term time, offline approval has already been obtained, so the pre-trip can
// be fast-tracked. The traveller attests this on the Submit step (TravelRequest.nonTermDeclared) and
// attaches the authorising e-mail under the docType below; the auto-approve routing is gated
// separately in the workflow configuration (off by default).
export const NON_TERM_APPROVAL_DOC = 'Non-term Offline Approval Email';

/** True when the request carries the attached non-term offline-approval e-mail. */
export function hasNonTermApproval(req: { attachments: { docType: string }[] }): boolean {
  return req.attachments.some((a) => a.docType === NON_TERM_APPROVAL_DOC);
}

// §13.x / DD-23 Emergency lane (book first, raise later) shared helpers.
import type { FullRequest } from './queries';

// The docType for the mandatory email approval that must be attached to an emergency request
// (the authorising officer's e-mail that authorised booking ahead of the full approval cycle).
export const EMERGENCY_APPROVAL_DOC = 'Emergency Approval Email';

/** True when the request carries the mandatory emergency email-approval attachment. */
export function hasEmergencyApproval(req: { attachments: { docType: string }[] }): boolean {
  return req.attachments.some((a) => a.docType === EMERGENCY_APPROVAL_DOC);
}

/** An emergency request may be booked before DOA ratification on the named officer's authority. */
export function isEmergencyBookFirst(req: Pick<FullRequest, 'isEmergency' | 'emergencyAuthoriserId'>): boolean {
  return !!req.isEmergency && !!req.emergencyAuthoriserId;
}

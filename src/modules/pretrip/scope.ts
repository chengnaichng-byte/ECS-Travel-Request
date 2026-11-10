// §GRP-11 (agreed rule 11 November 2026) every traveller in a group request can see it in their own
// list. A request is visible to a persona who raised it (requestor), is its individual traveller, or
// is a member of its group. Seeing is not editing (edit rights are CRT-3, unchanged). Shared by the
// Travel Request Dashboard and the home status band so both scope the same way.
export function isRequestVisibleTo(
  req: { requestorId: string; travellerId: string | null; travellers: { employeeId: string }[] },
  persona: string,
): boolean {
  return req.requestorId === persona || req.travellerId === persona || req.travellers.some((t) => t.employeeId === persona);
}

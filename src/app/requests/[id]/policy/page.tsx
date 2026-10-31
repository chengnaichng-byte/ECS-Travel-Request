// §6.3 Policy Review is merged into the Review & Submit step — this route now redirects there so any
// existing links (or a saved bookmark) land on the combined page. The policy checks, the inline
// "resolve justifications" and "re-run checks" all live on /review.
import { redirect } from 'next/navigation';

export default async function PolicyStep({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/requests/${id}/review`);
}

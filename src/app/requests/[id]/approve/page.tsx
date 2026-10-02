// Approver decisions are now inline on the request detail page (OpenAI design).
import { redirect } from 'next/navigation';

export default async function ApproveRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/requests/${id}`);
}

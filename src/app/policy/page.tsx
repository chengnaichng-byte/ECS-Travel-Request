// §4.1 Travel Policy moved into the Staff Profile (its "Travel Policy" tab). This route redirects
// there, preserving the traveller / destination selection so existing links keep working.
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function TravelPolicyPage({ searchParams }: { searchParams: Promise<{ traveller?: string; dest?: string }> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  if (sp.traveller) qs.set('traveller', sp.traveller);
  if (sp.dest) qs.set('dest', sp.dest);
  redirect(`/staff-profile${qs.toString() ? `?${qs}` : ''}`);
}

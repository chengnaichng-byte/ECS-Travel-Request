// The request detail page (OpenAI design) renders its own header + status bar, so the
// layout is just a full-width container. (Sub-routes like /trip and /booking still
// render inside it.)
import { notFound } from 'next/navigation';
import { loadRequest } from '@/modules/pretrip/queries';

export default async function RequestLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const req = await loadRequest(id);
  if (!req) notFound();
  return <div className="w-full">{children}</div>;
}

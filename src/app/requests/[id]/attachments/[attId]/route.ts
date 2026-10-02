// §2 Serve a stored attachment's bytes for inline view / download.
import { prisma } from '@/shared/db';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; attId: string }> }) {
  const { id, attId } = await params;
  const att = await prisma.attachment.findUnique({ where: { id: attId } });
  if (!att || att.requestId !== id || !att.content) {
    return new Response('Not found', { status: 404 });
  }
  const body = new Uint8Array(att.content);
  return new Response(body, {
    headers: {
      'Content-Type': att.contentType || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${att.fileName.replace(/"/g, '')}"`,
      'Content-Length': String(body.byteLength),
    },
  });
}

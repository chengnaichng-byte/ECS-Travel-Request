// §4.13 Visa-letter Excel export — the attachment that accompanies the daily HR email. One row per
// traveller needing a visa letter, with the fields HR needs to draft the support letter. Respects the
// Visa Letters page filter (Today / All dates + search) so the download matches what is on screen.
import * as XLSX from 'xlsx';
import { prisma } from '@/shared/db';
import { buildVisaLetterRecord, VISA_LETTER_COLUMNS } from '@/modules/pretrip/visaLetterNotice';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const view = url.searchParams.get('view') === 'all' ? 'all' : 'today';
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  const todayStr = new Date().toISOString().slice(0, 10);

  const all = await prisma.travelRequest.findMany({
    where: { visaLetterRequired: true },
    orderBy: { updatedAt: 'desc' },
    include: { allocations: true },
  });

  const rows = all
    .map((req) => ({ req, rec: buildVisaLetterRecord(req) }))
    .filter(({ req, rec }) => {
      const notifiedToday = !!req.visaLetterNotifiedAt && req.visaLetterNotifiedAt.toISOString().slice(0, 10) === todayStr;
      if (view === 'today' && !(notifiedToday || !req.visaLetterNotifiedAt)) return false;
      if (q && !`${rec.travelRequestRef} ${rec.traveller} ${rec.destination}`.toLowerCase().includes(q)) return false;
      return true;
    })
    .map((x) => x.rec);

  const aoa = [
    VISA_LETTER_COLUMNS.map((c) => c.header),
    ...rows.map((r) => VISA_LETTER_COLUMNS.map((c) => String(r[c.key] ?? ''))),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = VISA_LETTER_COLUMNS.map((c) => ({ wch: Math.max(14, c.header.length + 2, 24) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Visa letter requests');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="visa-letter-hr-${todayStr}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}

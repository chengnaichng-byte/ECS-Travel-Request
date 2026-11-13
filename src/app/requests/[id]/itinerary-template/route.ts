// §13.20/§4.5 Downloadable Excel template for the bulk itinerary / personal-days upload, generated
// server-side with ExcelJS so the Origin / Dest / Class / Traveller cells carry real in-cell DROPDOWNS
// (data validation). The dropdowns source from an Airports reference sheet and a hidden Lists sheet, both
// filled from the current masters + this request's travellers, so people pick valid values instead of
// typing codes. Parsing on upload is unchanged (SheetJS reads the Itineraries / Personal days sheets).
import ExcelJS from 'exceljs';
import { loadRequest } from '@/modules/pretrip/queries';
import { airports, cities } from '@/data/locations';
import { travelClasses } from '@/data/travelClass';
import { memberName } from '@/modules/pretrip/traveller';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const req = await loadRequest(id);
  if (!req) return new Response('Not found', { status: 404 });

  const travellers = req.travellers.map((t) => memberName(t)).filter(Boolean);
  const classNames = travelClasses.map((c) => c.name);
  const wb = new ExcelJS.Workbook();

  // --- Itineraries (data entry) ---
  const wsI = wb.addWorksheet('Itineraries');
  wsI.columns = [
    { header: 'Traveller', width: 24 }, { header: 'Seq', width: 6 }, { header: 'Origin', width: 9 }, { header: 'Dest', width: 9 },
    { header: 'Depart', width: 12 }, { header: 'Arrive', width: 12 }, { header: 'Class', width: 16 },
  ];
  const ex = travellers[0] ?? '';
  wsI.addRow([ex, 1, 'SIN', 'HND', '2026-12-31', '2026-12-31', classNames[0] ?? 'Economy']);
  wsI.addRow([ex, 2, 'HND', 'SIN', '2027-01-07', '2027-01-07', classNames[0] ?? 'Economy']);
  wsI.getRow(1).font = { bold: true };

  // --- Personal days (data entry) ---
  const wsP = wb.addWorksheet('Personal days');
  wsP.columns = [{ header: 'Traveller', width: 24 }, { header: 'From', width: 12 }, { header: 'To', width: 12 }, { header: 'Note', width: 26 }];
  wsP.addRow([ex, '2027-01-05', '2027-01-07', 'Personal extension']);
  wsP.getRow(1).font = { bold: true };

  // --- Airports (reference + Origin/Dest dropdown source) ---
  const wsA = wb.addWorksheet('Airports');
  wsA.columns = [{ header: 'Code', width: 8 }, { header: 'Airport', width: 30 }, { header: 'City', width: 16 }];
  airports.forEach((a) => wsA.addRow([a.code, a.name, cities.find((c) => c.code === a.cityCode)?.name ?? a.cityCode]));
  wsA.getRow(1).font = { bold: true };

  // --- Lists (Traveller + Class dropdown sources) ---
  const wsL = wb.addWorksheet('Lists');
  wsL.columns = [{ header: 'Traveller', width: 24 }, { header: 'Class', width: 16 }];
  const maxLen = Math.max(travellers.length, classNames.length);
  for (let i = 0; i < maxLen; i++) wsL.addRow([travellers[i] ?? null, classNames[i] ?? null]);
  wsL.getRow(1).font = { bold: true };
  wsL.state = 'hidden';

  // --- Dropdowns (data validation) over the first 200 data rows, one clean range per column ---
  const aEnd = airports.length + 1;          // Airports!A2:A{aEnd}
  const tEnd = Math.max(travellers.length, 1) + 1;  // Lists!A2:A{tEnd}
  const cEnd = classNames.length + 1;        // Lists!B2:B{cEnd}
  const listDV = (formula: string) => ({ type: 'list' as const, allowBlank: true, formulae: [formula] });
  wsI.dataValidations.add('A2:A201', listDV(`Lists!$A$2:$A$${tEnd}`));       // Traveller
  wsI.dataValidations.add('C2:D201', listDV(`Airports!$A$2:$A$${aEnd}`));    // Origin + Dest
  wsI.dataValidations.add('G2:G201', listDV(`Lists!$B$2:$B$${cEnd}`));       // Class
  wsP.dataValidations.add('A2:A201', listDV(`Lists!$A$2:$A$${tEnd}`));       // Traveller

  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="traveller-itineraries.xlsx"',
      'Cache-Control': 'no-store',
    },
  });
}

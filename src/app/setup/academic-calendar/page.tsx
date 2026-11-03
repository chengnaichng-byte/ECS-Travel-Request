// §13.x Academic Calendar — Setup & Maintenance. The single university-wide teaching calendar that
// drives the non-term-research derivation. Teaching and exam periods are term time; breaks are
// non-term time (a break overrides a teaching span, e.g. a recess week). Admin-editable per year.
import { prisma } from '@/shared/db';
import { currentPersona } from '@/shared/session';
import { ROLE } from '@/shared/enums';
import { PageTitle, Card } from '@/components/ui';
import { setTerm, removeTerm, addTerm } from './actions';

export const dynamic = 'force-dynamic';

const d = (x: Date) => x.toISOString().slice(0, 10);
const typePill = (t: string) => t === 'TEACHING' ? 'pill-navy' : t === 'EXAM' ? 'pill-warn' : 'pill-pass';

export default async function AcademicCalendarPage() {
  const persona = await currentPersona();
  const isAdmin = persona.roles.includes(ROLE.TravelAdmin) || persona.roles.includes(ROLE.SystemAdmin);
  const terms = await prisma.academicTerm.findMany({ orderBy: [{ academicYear: 'asc' }, { sortOrder: 'asc' }] });
  const byYear = new Map<string, typeof terms>();
  for (const t of terms) { const a = byYear.get(t.academicYear) ?? []; a.push(t); byYear.set(t.academicYear, a); }

  return (
    <div className="w-full space-y-5">
      <PageTitle id="TR-30" title="Academic calendar"
        subtitle="§13.x — the university-wide teaching calendar. Teaching and exam periods are term time; breaks/vacations are non-term time (a break overrides an overlapping teaching span). A research-funded trip whose whole travel window — personal days included — falls in non-term time is derived as a non-term research trip and can be fast-tracked; a trip outside the loaded calendar falls back to the manual attestation." />

      {!isAdmin && <div className="card p-3 text-sm text-amber-800 bg-amber-50 border-amber-200">Switch persona to <strong>David Kumar — Travel Administrator</strong> (or System Administrator) to edit. Read-only for other roles.</div>}

      {[...byYear.entries()].map(([ay, rows]) => (
        <Card key={ay} title={`Academic year ${ay} (${rows.length} period${rows.length === 1 ? '' : 's'})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>
                <th className="th">Period</th><th className="th">Type</th><th className="th">Start</th><th className="th">End</th>
                {isAdmin && <th className="th text-right">Action</th>}
              </tr></thead>
              <tbody>
                {rows.map((t) => isAdmin ? (
                  <tr key={t.id} className="hover:bg-[var(--ecs-panel-2)]">
                    <td className="td"><form id={`f-${t.id}`} action={setTerm.bind(null, t.id)} /><input form={`f-${t.id}`} name="name" defaultValue={t.name} className="field min-w-[12rem]" /></td>
                    <td className="td"><select form={`f-${t.id}`} name="type" defaultValue={t.type} className="field w-32"><option value="TEACHING">Teaching</option><option value="EXAM">Exam</option><option value="BREAK">Break</option></select></td>
                    <td className="td"><input form={`f-${t.id}`} name="startDate" type="date" defaultValue={d(t.startDate)} className="field w-40" /></td>
                    <td className="td"><input form={`f-${t.id}`} name="endDate" type="date" defaultValue={d(t.endDate)} className="field w-40" /></td>
                    <td className="td text-right whitespace-nowrap">
                      <button form={`f-${t.id}`} className="btn-ghost text-xs">Save</button>
                      <form action={removeTerm.bind(null, t.id)} className="inline"><button className="btn-ghost text-xs text-[var(--ecs-red)]">Remove</button></form>
                    </td>
                  </tr>
                ) : (
                  <tr key={t.id} className="hover:bg-[var(--ecs-panel-2)]">
                    <td className="td font-medium">{t.name}</td>
                    <td className="td"><span className={typePill(t.type)}>{t.type}</span></td>
                    <td className="td">{d(t.startDate)}</td>
                    <td className="td">{d(t.endDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      {isAdmin && (
        <Card title="Add a period">
          <form action={addTerm} className="flex flex-wrap items-end gap-2">
            <div><label className="label">Academic year</label><input name="academicYear" placeholder="2027/2028" className="field w-32" /></div>
            <div><label className="label">Period name</label><input name="name" placeholder="Semester 1 — Teaching" className="field w-56" /></div>
            <div><label className="label">Type</label><select name="type" defaultValue="TEACHING" className="field w-32"><option value="TEACHING">Teaching</option><option value="EXAM">Exam</option><option value="BREAK">Break</option></select></div>
            <div><label className="label">Start</label><input name="startDate" type="date" className="field w-40" /></div>
            <div><label className="label">End</label><input name="endDate" type="date" className="field w-40" /></div>
            <button className="btn-secondary text-sm">＋ Add period</button>
          </form>
        </Card>
      )}
    </div>
  );
}

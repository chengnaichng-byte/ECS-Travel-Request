'use client';
// TR-02 create form — Individual / Group / Guest (§13.14, §8). A group may mix employee
// members and guest (non-employee) members, up to the configured TMC group-booking limit.
// Group members may be added by ticking the directory, adding guest rows, or bulk-uploading
// an Excel/CSV member list (§13.13 — a coordinator building a large party).
import { useState, useRef } from 'react';
import { createDraft, createGroupDraft, createGuestDraft } from '@/modules/pretrip/actions';

interface Opt { id: string; name: string; title: string; dept: string; email?: string; delegated: boolean }
interface GuestRow { name: string; email: string; org: string }
const MODE_LABEL = { individual: 'Individual request', group: 'Group request', guest: 'Guest / non-employee' } as const;
type Mode = keyof typeof MODE_LABEL;

export function NewRequestForm({ persona, isRequestor, options, groupOptions, groupMax, groupEnabled }: {
  persona: { name: string; title: string }; isRequestor: boolean;
  options: Opt[]; groupOptions: Opt[]; groupMax: number; groupEnabled: boolean;
}) {
  const [mode, setMode] = useState<Mode>('individual');
  const defaultTraveller = options[0]?.id;
  const modes: Mode[] = groupEnabled ? ['individual', 'group', 'guest'] : ['individual', 'guest'];

  // Group state (employee selection + guest members)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [guests, setGuests] = useState<GuestRow[]>([]);
  const [importNote, setImportNote] = useState<string>('');
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [query, setQuery] = useState('');          // directory type-ahead search
  const [focused, setFocused] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const setGuest = (i: number, p: Partial<GuestRow>) => setGuests((g) => g.map((r, j) => j === i ? { ...r, ...p } : r));
  const addGuest = () => setGuests((g) => [...g, { name: '', email: '', org: '' }]);
  const delGuest = (i: number) => setGuests((g) => g.filter((_, j) => j !== i));
  const namedGuests = guests.filter((g) => g.name.trim());
  const total = selected.size + namedGuests.length;
  const over = total > groupMax;
  const tooFew = total < 2;

  // Directory type-ahead (scales to a large AD — no full list rendered).
  const optById = new Map(groupOptions.map((o) => [o.id, o] as const));
  const q = query.trim().toLowerCase();
  const matchesAll = groupOptions.filter((o) => !selected.has(o.id)
    && (!q || [o.name, o.dept, o.title, o.id, o.email ?? ''].some((v) => v.toLowerCase().includes(q))));
  const matches = matchesAll.slice(0, 8);
  const moreCount = matchesAll.length - matches.length;
  const addEmployee = (id: string) => { setSelected((s) => new Set(s).add(id)); setQuery(''); };

  // Resolve an employee by id, email or name (case-insensitive) against the directory.
  const resolveEmp = (key: string): Opt | undefined => {
    const k = key.trim().toLowerCase();
    if (!k) return undefined;
    return groupOptions.find((o) => o.id.toLowerCase() === k)
      ?? groupOptions.find((o) => (o.email ?? '').toLowerCase() === k)
      ?? groupOptions.find((o) => o.name.toLowerCase() === k);
  };

  // Bulk-import group members from an uploaded Excel/CSV file. Columns (case-insensitive):
  // Type · Employee ID · Name · Email · Organisation. Employee rows resolve against the ECS
  // directory; guest rows are captured verbatim. Merges into the current selection.
  const onExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await importMembers(file);
    if (fileRef.current) fileRef.current.value = ''; // allow re-selecting the same file
  };

  const importMembers = async (file: File) => {
    setImportNote(''); setImportErrors([]);
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

      const pick = (row: Record<string, string>, ...keys: string[]) => {
        for (const k of keys) { const v = row[k]; if (v != null && String(v).trim()) return String(v).trim(); }
        return '';
      };
      const addEmp = new Set<string>(selected);
      const addGuests: GuestRow[] = [...guests];
      const errs: string[] = [];
      let nEmp = 0, nGuest = 0;

      rows.forEach((raw, i) => {
        // normalise header keys to lowercase
        const row: Record<string, string> = {};
        for (const [k, v] of Object.entries(raw)) row[k.trim().toLowerCase()] = v == null ? '' : String(v);
        const type = pick(row, 'type', 'member type').toLowerCase();
        const empId = pick(row, 'employee id', 'employeeid', 'staff id', 'id');
        const name = pick(row, 'name', 'traveller', 'guest name', 'full name');
        const email = pick(row, 'email', 'guest email', 'e-mail');
        const org = pick(row, 'organisation', 'organization', 'org', 'home organisation', 'affiliation');
        const rowNo = i + 2; // header is row 1

        if (!type && !empId && !name && !email) return; // blank row

        const asGuest = () => {
          if (!name) { errs.push(`Row ${rowNo}: guest needs a name.`); return; }
          if (!addGuests.some((g) => g.name.trim().toLowerCase() === name.toLowerCase())) { addGuests.push({ name, email, org }); nGuest++; }
        };

        if (type.startsWith('guest')) { asGuest(); return; }
        if (type.startsWith('emp') || empId) {
          const emp = resolveEmp(empId || name || email);
          if (emp) { if (!addEmp.has(emp.id)) { addEmp.add(emp.id); nEmp++; } }
          else errs.push(`Row ${rowNo}: no employee matches "${empId || name || email}".`);
          return;
        }
        // Untyped row: match an employee by name/email, else treat as a guest.
        const emp = resolveEmp(name || email);
        if (emp) { if (!addEmp.has(emp.id)) { addEmp.add(emp.id); nEmp++; } }
        else asGuest();
      });

      setSelected(addEmp);
      setGuests(addGuests);
      setImportErrors(errs);
      const parts: string[] = [];
      if (nEmp) parts.push(`${nEmp} employee${nEmp > 1 ? 's' : ''}`);
      if (nGuest) parts.push(`${nGuest} guest${nGuest > 1 ? 's' : ''}`);
      setImportNote(parts.length ? `Imported ${parts.join(' and ')} from ${file.name}.` : `No new members found in ${file.name}.`);
    } catch (err) {
      setImportErrors([`Could not read the file — ${(err as Error).message}. Expected .xlsx, .xls or .csv.`]);
    }
  };

  const downloadTemplate = async () => {
    const XLSX = await import('xlsx');
    const header = ['Type', 'Employee ID', 'Name', 'Email', 'Organisation'];
    const sample = [
      { Type: 'Employee', 'Employee ID': groupOptions[0]?.id ?? 'E-TRAV', Name: groupOptions[0]?.name ?? '', Email: '', Organisation: '' },
      { Type: 'Guest', 'Employee ID': '', Name: 'Prof Maria Santos', Email: 'maria.santos@mit.edu', Organisation: 'MIT' },
    ];
    const ws = XLSX.utils.json_to_sheet(sample, { header });
    ws['!cols'] = [{ wch: 10 }, { wch: 14 }, { wch: 26 }, { wch: 26 }, { wch: 22 }];
    const dir = groupOptions.map((o) => ({ 'Employee ID': o.id, Name: o.name, Department: o.dept, Email: o.email ?? '' }));
    const ws2 = XLSX.utils.json_to_sheet(dir);
    ws2['!cols'] = [{ wch: 14 }, { wch: 26 }, { wch: 40 }, { wch: 28 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Members');
    XLSX.utils.book_append_sheet(wb, ws2, 'Employee directory');
    XLSX.writeFile(wb, 'group-members-template.xlsx');
  };

  return (
    <div>
      <div className="card p-2 mb-4 inline-flex gap-1">
        {modes.map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)}
            className={mode === m ? 'btn-primary' : 'btn-ghost'}>
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      {mode === 'guest' ? (
        <form action={createGuestDraft}>
          <div className="card">
            <div className="card-head">Guest / Non-Employee Traveller (§8)</div>
            <div className="p-4 space-y-4">
              <div>
                <label className="label">Host / Requestor (you)</label>
                <div className="text-sm px-3 py-2 bg-[var(--ecs-panel-2)] rounded border border-[var(--ecs-border)]">{persona.name} — {persona.title}</div>
              </div>
              <div>
                <label className="label" htmlFor="guestName">Guest name</label>
                <input id="guestName" name="guestName" required className="field" placeholder="e.g. Prof Maria Santos" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label" htmlFor="guestEmail">Guest email</label><input id="guestEmail" name="guestEmail" type="email" className="field" placeholder="maria.santos@example.edu" /></div>
                <div><label className="label" htmlFor="guestOrg">Home organisation</label><input id="guestOrg" name="guestOrg" className="field" placeholder="e.g. MIT" /></div>
              </div>
              <p className="text-xs text-[var(--ecs-muted)]">The guest has no ECS/HR profile; their identity is captured here and the trip is charged to your department. Entitlement defaults to Economy unless an exception is approved (§8, AC7).</p>
            </div>
          </div>
          <div className="mt-4 flex justify-end"><button className="btn-primary">Create guest draft →</button></div>
        </form>
      ) : mode === 'individual' ? (
        <form action={createDraft}>
          <div className="card">
            <div className="card-head">Traveller</div>
            <div className="p-4 space-y-4">
              <div>
                <label className="label">Requestor (you)</label>
                <div className="text-sm px-3 py-2 bg-[var(--ecs-panel-2)] rounded border border-[var(--ecs-border)]">{persona.name} — {persona.title}{isRequestor && <span className="pill-navy ml-1">Travel Requestor</span>}</div>
              </div>
              <div>
                <label className="label" htmlFor="travellerId">Traveller</label>
                <select id="travellerId" name="travellerId" className="field" defaultValue={defaultTraveller}>
                  {options.map((e) => <option key={e.id} value={e.id}>{e.name} — {e.title} ({e.dept}){e.delegated ? ' · delegated' : ''}</option>)}
                </select>
                {isRequestor && <p className="text-xs text-[var(--ecs-muted)] mt-1">Creating on behalf of a traveller; approval, entitlements and declarations derive from the traveller (§13.13).</p>}
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-end"><button className="btn-primary">Create draft →</button></div>
        </form>
      ) : (
        <form action={createGroupDraft}>
          {[...selected].map((id) => <input key={id} type="hidden" name="travellerIds" value={id} />)}
          <input type="hidden" name="guestsJson" value={JSON.stringify(namedGuests.map((g) => ({ name: g.name.trim(), email: g.email.trim(), org: g.org.trim() })))} />
          <div className="card">
            <div className="card-head flex items-center justify-between">
              <span>Group Travellers</span>
              <span className={`text-xs font-normal ${over ? 'text-[var(--ecs-red)]' : 'text-[var(--ecs-muted)]'}`}>{total} of max {groupMax}</span>
            </div>
            <div className="p-4">
              <label className="label">Requestor (you)</label>
              <div className="text-sm px-3 py-2 bg-[var(--ecs-panel-2)] rounded border border-[var(--ecs-border)] mb-4">{persona.name} — {persona.title}{isRequestor && <span className="pill-navy ml-1">Travel Requestor</span>}</div>

              {/* Bulk import */}
              <div className="rounded border border-dashed border-[var(--ecs-border)] bg-[var(--ecs-panel-2)] p-3 mb-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="text-sm font-medium">Bulk-add members from Excel</div>
                    <div className="text-xs text-[var(--ecs-muted)]">Columns: <code>Type</code>, <code>Employee ID</code>, <code>Name</code>, <code>Email</code>, <code>Organisation</code>. Employees resolve from the ECS directory; everything else is treated as a guest.</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" className="btn-secondary text-xs" onClick={() => fileRef.current?.click()}>⬆ Upload Excel / CSV</button>
                    <button type="button" className="btn-ghost text-xs" onClick={downloadTemplate}>Download template</button>
                  </div>
                </div>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onExcel} />
                {importNote && <p className="text-xs text-[var(--ecs-navy-2)] mt-2">{importNote}</p>}
                {importErrors.length > 0 && (
                  <details className="mt-1" open>
                    <summary className="text-xs text-[var(--ecs-red)] cursor-pointer">{importErrors.length} row{importErrors.length > 1 ? 's' : ''} skipped</summary>
                    <ul className="text-xs text-[var(--ecs-red)] mt-1 list-disc pl-4">{importErrors.map((er, i) => <li key={i}>{er}</li>)}</ul>
                  </details>
                )}
              </div>

              <label className="label">Employee travellers (each confirms inclusion — §13.13)</label>
              {selected.size > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {[...selected].map((id) => {
                    const o = optById.get(id);
                    return (
                      <span key={id} className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full border border-[var(--ecs-border)] bg-[var(--ecs-panel-2)] text-sm">
                        <span>{o?.name ?? id}</span>
                        {o && <span className="text-xs text-[var(--ecs-muted)]">{o.dept}</span>}
                        <button type="button" onClick={() => toggle(id)} aria-label={`Remove ${o?.name ?? id}`}
                          className="text-[var(--ecs-muted)] hover:text-[var(--ecs-red)] leading-none px-0.5">✕</button>
                      </span>
                    );
                  })}
                </div>
              )}
              <div className="relative">
                <input type="text" className="field" placeholder="Search the directory by name, department or ID…"
                  value={query} onChange={(e) => setQuery(e.target.value)}
                  onFocus={() => setFocused(true)} onBlur={() => setTimeout(() => setFocused(false), 150)} />
                {focused && (
                  <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-[var(--ecs-border)] rounded-md shadow-lg max-h-64 overflow-y-auto">
                    {matches.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-[var(--ecs-muted)]">{q ? 'No matching employees.' : 'All directory employees are already selected.'}</div>
                    ) : (
                      <>
                        {matches.map((o) => (
                          <button key={o.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => addEmployee(o.id)}
                            className="w-full text-left px-3 py-2 hover:bg-[var(--ecs-panel-2)] border-b border-[var(--ecs-border)] last:border-0">
                            <span className="text-sm">{o.name}</span>
                            <span className="text-xs text-[var(--ecs-muted)]"> — {o.title} ({o.dept})</span>
                          </button>
                        ))}
                        {moreCount > 0 && <div className="px-3 py-1.5 text-xs text-[var(--ecs-muted)] bg-[var(--ecs-panel-2)]">+{moreCount} more — refine your search</div>}
                      </>
                    )}
                  </div>
                )}
              </div>
              <p className="text-xs text-[var(--ecs-muted)] mt-1">Type to search the directory, pick to add. {selected.size} employee{selected.size === 1 ? '' : 's'} selected.</p>

              <div className="flex items-center justify-between mt-4 mb-1">
                <label className="label mb-0">Guest members (non-employees, §8)</label>
                <button type="button" className="btn-ghost text-xs" onClick={addGuest}>＋ Add guest</button>
              </div>
              {guests.length === 0 ? (
                <p className="text-xs text-[var(--ecs-muted)]">Add external speakers or collaborators travelling with the group. A guest flies Economy by default, is charged to your (host) department, and is settled centrally — guests do not file their own claim.</p>
              ) : (
                <div className="space-y-2">
                  {guests.map((g, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
                      <input className="field" placeholder="Guest name" value={g.name} onChange={(e) => setGuest(i, { name: e.target.value })} />
                      <input className="field" placeholder="Email (optional)" value={g.email} onChange={(e) => setGuest(i, { email: e.target.value })} />
                      <input className="field" placeholder="Organisation" value={g.org} onChange={(e) => setGuest(i, { org: e.target.value })} />
                      <button type="button" className="btn-ghost text-xs" onClick={() => delGuest(i)}>✕</button>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-xs text-[var(--ecs-muted)] mt-3">Approved once on the group total; the DOA is derived from the highest charging department. The requestor holds no cost share (§13.14). A group booking is limited to <strong>{groupMax}</strong> travellers (TMC group limit).</p>
              {over && <p className="text-xs text-[var(--ecs-red)] mt-1">Over the limit — remove {total - groupMax} traveller{total - groupMax > 1 ? 's' : ''}.</p>}
            </div>
          </div>
          <div className="mt-4 flex justify-end"><button className="btn-primary" disabled={over || tooFew}>Create group draft →</button></div>
        </form>
      )}
    </div>
  );
}

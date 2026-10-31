// Inline edit form for ONE existing estimate cost line, usable from the Estimates OR the Charging
// step. It renders the matching category form pre-filled with the line's values, updates it in place
// (updateAirfare / updateAccommodation / updateOther carry a returnTo so they come back to the page
// that opened the editor), and offers a Cancel. An individual/guest airfare reuses AirfareForm so the
// upgrade-justification gating applies; a group airfare keeps its class locked to each entitlement.
import Link from 'next/link';
import { Card } from '@/components/ui';
import { AirfareForm } from '@/components/AirfareForm';
import { AccommodationCityRate } from '@/components/AccommodationCityRate';
import { cities, airports } from '@/data/locations';
import { travelClasses } from '@/data/travelClass';
import { hotelCaps } from '@/data/policyRates';
import { expenseTypes } from '@/data/expenseTypes';
import { EcsIdentity } from '@/shared/ecs/services';
import { provostsForSchool } from '@/modules/pretrip/provost';
import { makeEntitledClassFor } from '@/modules/pretrip/liveOutcome';
import { isGuestRequest, memberName } from '@/modules/pretrip/traveller';
import { updateAirfare, updateAccommodation, updateOther } from '@/modules/pretrip/actions';
import { fmtSgd } from '@/modules/pretrip/pricing';
import { EXPENSE_CATEGORY } from '@/shared/enums';
import type { FullRequest } from '@/modules/pretrip/queries';

const d = (x: Date | null | undefined) => (x ? x.toISOString().slice(0, 10) : '');

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="label">{label}</label>{children}</div>;
}

export async function EstimateLineEditor({ req, editExp, id, returnTo }: {
  req: FullRequest; editExp: FullRequest['expenses'][number]; id: string; returnTo: string;
}) {
  const e = editExp;
  const isGroup = req.isGroup;
  const isMultiCity = req.tripType === 'MULTI_CITY';
  const cancel = <Link href={returnTo} className="btn-secondary text-xs">Cancel</Link>;
  // Airfare flight date is derived from the itinerary (the matching sector's departure, else the first
  // leg's) and shown read-only — it is not a value to key on the cost line. See the airfare forms.
  const sharedLegs = req.legs.filter((l) => !l.travellerId).sort((a, b) => a.seq - b.seq);
  const airfareDepart = (origin?: string | null, dest?: string | null) => {
    const leg = sharedLegs.find((l) => l.originCode === origin && l.destCode === dest);
    return d(leg?.departDate ?? null) || d(sharedLegs[0]?.departDate ?? null) || d(req.startDate);
  };
  const member = e.travellerId ? req.travellers.find((t) => t.employeeId === e.travellerId) : undefined;
  const travellerLabel = member ? memberName(member) : (e.travellerId ? EcsIdentity.employee(e.travellerId)?.name ?? e.travellerId : null);
  const capByCity: Record<string, number> = Object.fromEntries(hotelCaps.map((h) => [h.cityCode, h.capNightlySgd]));

  if (e.category === EXPENSE_CATEGORY.Airfare) {
    // §13.14 a group books each traveller at their entitlement (class locked) → simple inline form.
    if (isGroup) {
      return (
        <Card title="Edit airfare line" className="mb-5" id="edit-line" actions={<>{cancel}<button form="el-airfare" type="submit" className="btn-primary text-xs">Save airfare changes</button></>}>
          <form id="el-airfare" action={updateAirfare.bind(null, id, e.id)} className="space-y-3">
            <input type="hidden" name="returnTo" value={returnTo} />
            <div className="grid grid-cols-2 gap-3">
              <Field label={isMultiCity ? 'Departure from' : 'Origin'}><select name="originCode" defaultValue={e.originCode ?? 'SIN'} className="field">{airports.map((a) => <option key={a.code} value={a.code}>{a.code}</option>)}</select></Field>
              <Field label={isMultiCity ? 'Primary destination' : 'Destination'}><select name="destCode" defaultValue={e.destCode ?? ''} className="field">{airports.filter((a) => a.cityCode !== 'SIN').map((a) => <option key={a.code} value={a.code}>{a.code}</option>)}</select></Field>
              <div><label className="label">Proposed class</label><div className="field bg-[var(--ecs-panel)] text-[var(--ecs-muted)] cursor-not-allowed">Per traveller — set to entitlement</div></div>
              <div>
                <label className="label">Expected date of travel</label>
                <div className="field bg-[var(--ecs-panel)] text-[var(--ecs-muted)] cursor-not-allowed flex items-center justify-between gap-2">
                  <span>{airfareDepart(e.originCode, e.destCode) || 'Set on the Trip step'}</span>
                  <span className="text-[11px] whitespace-nowrap">from the itinerary</span>
                </div>
                <input type="hidden" name="expectedDate" value={airfareDepart(e.originCode, e.destCode)} />
              </div>
              <input type="hidden" name="currency" value="SGD" />
              <Field label="Quoted amount (SGD)"><input name="amount" type="number" step="any" defaultValue={String(e.foreignAmount)} className="field" /></Field>
              <Field label="Expected sponsorship"><input name="sponsorship" type="number" step="any" defaultValue={String(e.sponsorForeign ?? 0)} className="field" /></Field>
              <div><label className="label">Traveller</label><div className="field bg-[var(--ecs-panel)] text-[var(--ecs-muted)]">{travellerLabel ?? '—'}</div></div>
            </div>
          </form>
        </Card>
      );
    }
    const entitledFor = makeEntitledClassFor(req);
    const entId = entitledFor(req.travellerId);
    // M6 (entitlement differential) is a Charging concern — intentionally not surfaced on the airfare card.
    const guest = isGuestRequest(req);
    const hostSchoolId = req.departmentId ?? EcsIdentity.employee(req.requestorId)?.departmentId ?? null;
    const provostOptions = guest ? await provostsForSchool(hostSchoolId) : [];
    const economyId = travelClasses.find((c) => /eco/i.test(c.name))?.id ?? 'TC-ECO';
    return (
      <Card title="Edit airfare line" className="mb-5" id="edit-line">
        <AirfareForm
          action={updateAirfare.bind(null, id, e.id)}
          submitLabel="Save airfare changes"
          editing
          multiCity={isMultiCity}
          cancel={cancel}
          returnTo={returnTo}
          originOpts={airports.map((a) => [a.code, a.code])}
          destOpts={airports.filter((a) => a.cityCode !== 'SIN').map((a) => [a.code, a.code])}
          classOpts={travelClasses.map((c) => [c.id, c.name])}
          classRanks={Object.fromEntries(travelClasses.map((c) => [c.id, c.rank]))}
          defaults={{
            origin: e.originCode ?? 'SIN',
            dest: e.destCode ?? '',
            proposedClassId: e.proposedClassId ?? entId,
            expectedDate: airfareDepart(e.originCode, e.destCode),
            currency: e.currency,
            amount: String(e.foreignAmount),
            sponsorship: String(e.sponsorForeign ?? 0),
            classJustification: req.classJustification ?? '',
            upgradeFunding: e.upgradeFunding ?? 'NTU',
          }}
          entitledClassId={entId}
          entitledClassName={travelClasses.find((c) => c.id === entId)?.name ?? 'Economy'}
          guest={guest}
          provostOpts={provostOptions.map((p) => ({ approverId: p.approverId, name: p.name, title: p.title, dept: EcsIdentity.department(p.schoolId)?.name ?? p.schoolId }))}
          provostDefault={req.provostId ?? ''}
          guestUpgrading={guest && !!req.travelClassId && req.travelClassId !== economyId}
        />
      </Card>
    );
  }

  if (e.category === EXPENSE_CATEGORY.Accommodation) {
    const a = e.accommodation;
    return (
      <Card title="Edit accommodation line" className="mb-5" id="edit-line" actions={<>{cancel}<button form="el-accom" type="submit" className="btn-primary text-xs">Save accommodation changes</button></>}>
        <form id="el-accom" action={updateAccommodation.bind(null, id, e.id)} className="space-y-3">
          <input type="hidden" name="returnTo" value={returnTo} />
          {travellerLabel && <p className="text-xs text-[var(--ecs-muted)]">Editing this accommodation line for <b>{travellerLabel}</b>.</p>}
          <div className="grid grid-cols-2 gap-3">
            <AccommodationCityRate cities={cities.filter((c) => c.code !== 'SIN').map((c) => [c.code, c.name])} caps={capByCity} defaultCity={a?.city ?? req.destCity ?? ''} defaultRate={a ? String(a.quotedNightly) : undefined} />
            <Field label="Nights"><input name="nights" type="number" step="any" defaultValue={a ? String(a.nights) : ''} className="field" /></Field>
            <Field label="Personal nights"><input name="personalNights" type="number" step="any" defaultValue={a ? String(a.personalNights) : '0'} className="field" /></Field>
            <Field label="Check-in"><input name="checkIn" type="date" defaultValue={d(a?.checkIn)} className="field" /></Field>
            <Field label="Check-out"><input name="checkOut" type="date" defaultValue={d(a?.checkOut)} className="field" /></Field>
          </div>
          <Field label="Justification / note — explain here if the nightly rate is above the city cap (shown to the approver)"><input name="notes" defaultValue={e.notes ?? ''} className="field" /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="conferenceHotel" defaultChecked={a?.conferenceHotel ?? false} /> Conference hotel</label>
          <p className="text-xs text-[var(--ecs-muted)]">The rate <b>defaults to the selected city&apos;s cap</b> and budgets at the <b>lower of the quoted rate and the cap</b> (a rate above the cap is capped and needs a justification). Caps — {hotelCaps.filter((h) => h.cityCode !== 'SIN').map((h) => `${h.cityCode} ${fmtSgd(h.capNightlySgd)}`).join(', ')}.</p>
        </form>
      </Card>
    );
  }

  // Other / incidental
  return (
    <Card title="Edit cost line" className="mb-5" id="edit-line" actions={<>{cancel}<button form="el-other" type="submit" className="btn-primary text-xs">Save changes</button></>}>
      <form id="el-other" action={updateOther.bind(null, id, e.id)} className="space-y-3">
        <input type="hidden" name="returnTo" value={returnTo} />
        {travellerLabel && <p className="text-xs text-[var(--ecs-muted)]">Editing this line for <b>{travellerLabel}</b>.</p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Expense type"><select name="expenseTypeId" defaultValue={e.expenseTypeId} className="field">{expenseTypes.filter((t) => !t.isMajorCost).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
          <input type="hidden" name="currency" value="SGD" />
          <Field label="Amount (SGD)"><input name="amount" type="number" step="any" defaultValue={String(e.foreignAmount)} className="field" /></Field>
          <Field label="Note"><input name="notes" defaultValue={e.notes ?? ''} className="field" /></Field>
        </div>
      </form>
    </Card>
  );
}

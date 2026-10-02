// §13.18 Configuration Viewer — a single read-only page listing the seeded ECS
// masters, so a demonstration can show the SOURCE of caps, rates and bands. Not
// editable; the prototype consumes this configuration, it does not maintain it.
import { PageTitle, Card } from '@/components/ui';
import { expenseTypes } from '@/data/expenseTypes';
import { travelPurposes } from '@/data/travelPurposes';
import { hotelCaps, hotelCapsByCountry, odaRates } from '@/data/policyRates';
import { travelClasses } from '@/data/travelClass';
import { travelClassRegister } from '@/data/travelClassRegister';
import { chargingCodes } from '@/data/charging';
import { workflowBands } from '@/data/workflow';
import { fxRates } from '@/data/fxRates';
import { tolerances } from '@/data/tolerances';
import { cities, airports } from '@/data/locations';
import { employees } from '@/data/employees';
import { delegations } from '@/data/delegations';
import { policyRules } from '@/config/policyRules';
import { rejectionReasons } from '@/data/rejectionReasons';

function T({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead><tr>{head.map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="hover:bg-[var(--ecs-panel-2)]">{r.map((c, j) => <td key={j} className="td">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export default function ConfigViewer() {
  return (
    <div className="w-full space-y-5">
      <PageTitle id="TR-19 · read-only" title="ECS Configuration Viewer"
        subtitle="Seeded masters consumed read-only by the pre-trip module (§13.18). No maintenance screens exist in the prototype (AC37); all values are retrieved from the mock ECS services by shared identifier." />

      <Card title="Expense Types (shared ECS / TE codes)">
        <T head={['ID', 'TE code', 'Name', 'Category', 'GL', 'GST', 'Tax %', 'Major cost', 'Estimate form', 'Variance %']}
          rows={expenseTypes.map((e) => [e.id, e.teCode, e.name, e.category, e.glAccount, e.gstCode, e.taxRatePct + '%', e.isMajorCost ? 'Yes' : 'No', e.estimateFormType, e.varianceThreshold])} />
        <p className="text-xs text-[var(--ecs-muted)] mt-2">GST/tax codes are reused from ECS (ZP/OS zero-rated or out-of-scope for overseas travel; SR standard-rated 9%) and drive the tax treatment at the claim stage (§13).</p>
      </Card>

      <Card title="Travel Purposes (reused ECS master · Setup & Maintenance)">
        <T head={['Travel purpose', 'GL account code', 'Expense types', 'Research', 'TE linkage req.', 'Status']}
          rows={travelPurposes.map((p) => [p.name, p.glAccountCode, p.expenseTypes || '—', p.isResearch ? 'Yes' : 'No', p.teLinkageRequired ? 'Yes' : 'No', p.active ? 'Active' : 'Inactive'])} />
        <p className="text-xs text-[var(--ecs-muted)] mt-2">Mirrors the ECS Travel Purpose master (name, GL account code, allowed expense types, status). Inactive purposes are hidden from selection on new requests. Research-staff purposes route via the Research DOA line (§13.14).</p>
      </Card>

      <div className="grid md:grid-cols-2 gap-5">
        <Card title="Hotel Caps — by city (override)">
          <T head={['City', 'Cap', 'Effective']} rows={hotelCaps.map((h) => [h.cityCode, h.capNightlySgd, h.effectiveFrom])} />
        </Card>
        <Card title="ODA Rates (SGD / day)">
          <T head={['Country', 'Rate', 'Effective']} rows={odaRates.map((o) => [o.countryCode, o.dailyRateSgd, o.effectiveFrom])} />
        </Card>
      </div>

      <Card title="Hotel Caps — by country (§15 · fallback when no city cap)">
        <T head={['Country', 'Cap / night (SGD)', 'Effective']} rows={hotelCapsByCountry.map((h) => [h.countryCode, h.capNightlySgd, h.effectiveFrom])} />
        <p className="text-xs text-[var(--ecs-muted)] mt-2">Accommodation caps are maintained by country (A–Z); a city-specific cap above overrides the country cap for high-cost cities.</p>
      </Card>

      <Card title="Travel Class Register (§13.19 · Figure D5)">
        <T head={['Employee', 'Display name', 'Entitled class', 'Policy group', 'Duration', 'Effective from', 'Effective to']}
          rows={travelClassRegister.map((r) => [r.employeeId, r.displayName, travelClasses.find((c) => c.id === r.entitledClassId)?.name ?? r.entitledClassId, r.policyGroup, `≥ ${r.minHours}h`, r.effectiveFrom, r.effectiveTo])} />
        <p className="text-xs text-[var(--ecs-muted)] mt-2">Employees not listed default to Economy. Duration condition applies the entitled class only to flight legs meeting the hours threshold (§13.19).</p>
      </Card>

      <Card title="Rejection Reasons (§26 · reused ECS master)">
        <T head={['Code', 'Reason']} rows={rejectionReasons.map((r) => [r.code, r.label])} />
      </Card>

      <Card title="Policy Rules (§25/§43 · config-driven)">
        <T head={['Code', 'Rule', 'Category', 'Outcome', 'Effective from', 'Enforcement']}
          rows={policyRules.map((r) => [r.code, r.name, r.category, r.defaultOutcome, r.effectiveFrom, r.mandatory ? 'Mandatory' : r.active ? 'Active' : 'Inactive'])} />
        <p className="text-xs text-[var(--ecs-muted)] mt-2">The policy engine gates each discretionary check on its active flag and effective date (mandatory structural checks always run). Turning a rule off or dating it changes evaluation without code changes (§43).</p>
      </Card>

      <Card title="Workflow Amount Bands">
        <T head={['Band', 'From (SGD)', 'To (SGD)', 'DOA tier', 'Label']}
          rows={workflowBands.map((b) => [b.id, b.minSgd, b.maxSgd ?? '∞', b.doaTierIndex + 1, b.label])} />
      </Card>

      <div className="grid md:grid-cols-2 gap-5">
        <Card title="Charging Codes (CC / WBS)">
          <T head={['Code', 'Name', 'Type', 'Sub-type', 'Dept', 'Research', 'Status']} rows={chargingCodes.map((c) => [c.code, c.name, c.type, c.subType ?? '—', c.departmentId, c.isResearch ? 'Yes' : 'No', c.active === false ? 'Closed' : 'Active'])} />
        </Card>
        <Card title="Exchange Rates (monthly, SGD per unit)">
          <T head={['Currency', 'SGD/unit', 'Month']} rows={fxRates.map((f) => [f.currency, f.sgdPerUnit, f.month])} />
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <Card title="Locations (city / airport)">
          <T head={['City', 'Timezone', 'Airports']} rows={cities.map((c) => [c.name, c.timezone, airports.filter((a) => a.cityCode === c.code).map((a) => a.code).join(', ')])} />
        </Card>
        <Card title="Tolerances (§13.7)">
          <T head={['Rule', 'Value']} rows={[
            ['Booking fare deviation', `+${tolerances.bookingFarePct}% or +SGD ${tolerances.bookingFareAbsSgd} (lower)`],
            ['Date shift', `${tolerances.dateShiftDays} days`],
            ['Estimate amendment', `+${tolerances.estimateAmendPct}% or +SGD ${tolerances.estimateAmendAbsSgd}`],
          ]} />
        </Card>
      </div>

      <Card title="Personas, Roles & Delegations (§13.7 / §13.13)">
        <T head={['ID', 'Name', 'Title', 'Department', 'Roles']}
          rows={employees.map((e) => [e.id, e.name, e.title, e.departmentId, e.roles.join(', ')])} />
        <p className="text-xs text-[var(--ecs-muted)] mt-2">
          Delegations: {delegations.map((d) => `${d.principalId} → ${d.delegateId} (${d.kind})`).join('; ')}
        </p>
      </Card>
    </div>
  );
}

// #5 Travel Policy reference — a read-only, traveller-facing view of the applicable policies,
// guidelines and entitlements (class entitlement, accommodation caps, ODA, the policy checks and
// the booking/payment rules). Assembled from the same seeded ECS masters the request flow enforces,
// so what a traveller reads here is exactly what the engine applies. Distinct from the technical
// Configuration Viewer (every raw master): this is organised as guidelines for the person travelling.
import { PageTitle, Card } from '@/components/ui';
import { travelClasses } from '@/data/travelClass';
import { travelClassRegister } from '@/data/travelClassRegister';
import { hotelCaps, hotelCapsByCountry, odaRates, ODA_TIER1_END_DAY, ODA_TIER1_PCT, ODA_TIER2_END_DAY, ODA_TIER2_PCT, ODA_MONTHLY_DAYS } from '@/data/policyRates';
import { policyRules } from '@/config/policyRules';
import { POLICY_OUTCOME } from '@/shared/enums';
import { EcsReference } from '@/shared/ecs/services';

const className = (id: string) => travelClasses.find((c) => c.id === id)?.name ?? id;
const countryName = (code: string) => EcsReference.country(code)?.name ?? code;
const cityName = (code: string) => EcsReference.city(code)?.name ?? code;

// One entitlement row per travel policy group (the register is per-employee; a group's rule is the
// same for everyone in it). Highest-entitlement sample wins if a group ever had mixed rows.
const groupRows = [...new Map(travelClassRegister.map((r) => [r.policyGroup, r])).values()]
  .sort((a, b) => a.policyGroup.localeCompare(b.policyGroup));

const outcomePill: Record<string, string> = {
  [POLICY_OUTCOME.HardStop]: 'pill-stop',
  [POLICY_OUTCOME.Exception]: 'pill-warn',
  [POLICY_OUTCOME.Warning]: 'pill-info',
  [POLICY_OUTCOME.Pass]: 'pill-pass',
};
const outcomeLabel: Record<string, string> = {
  [POLICY_OUTCOME.HardStop]: 'Hard stop — must fix before submitting',
  [POLICY_OUTCOME.Exception]: 'Exception — allowed with approval + justification',
  [POLICY_OUTCOME.Warning]: 'Warning — advisory, you may proceed',
};
const ruleGroups = [POLICY_OUTCOME.HardStop, POLICY_OUTCOME.Exception, POLICY_OUTCOME.Warning];

export default function TravelPolicyPage() {
  return (
    <div className="w-full space-y-5">
      <PageTitle id="Reference" title="Travel Policy &amp; Entitlements"
        subtitle="The travel policies, entitlements and checks that apply to a pre-trip request. These are the same rules the system enforces as you build and submit — shown here so you can plan before you start." />

      <Card title="How policy is applied">
        <ul className="text-sm text-[var(--ecs-muted)] space-y-1.5 list-disc pl-5">
          <li><strong>Entitlements</strong> (travel class, accommodation caps, daily allowance) are pre-filled from your profile and the destination — you don&apos;t enter them.</li>
          <li>As you build the request, checks run live and fall into three kinds: a <span className="pill-stop">hard stop</span> you must fix, an <span className="pill-warn">exception</span> allowed with approval and a justification, and a <span className="pill-info">warning</span> that is advisory only.</li>
          <li>An exception approved at the pre-trip stage is <strong>not re-approved</strong> at the expense claim, as long as the actual stays within the configured tolerance.</li>
        </ul>
      </Card>

      {/* ---------------- Travel class entitlement ---------------- */}
      <Card title="Travel class entitlement">
        <p className="text-sm text-[var(--ecs-muted)] mb-3">Your entitled cabin is set by your travel policy group and the flight duration. A class above your entitlement is allowed only as an <span className="pill-warn">exception</span> with a justification (a guest upgrade also needs Provost authorisation).</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className="th">Travel policy group</th><th className="th">Entitled class</th><th className="th">Applies to flights</th></tr></thead>
            <tbody>
              {groupRows.map((r) => (
                <tr key={r.policyGroup} className="hover:bg-[var(--ecs-panel-2)]">
                  <td className="td font-mono text-xs">{r.policyGroup}</td>
                  <td className="td">{className(r.entitledClassId)}</td>
                  <td className="td">{r.minHours > 0 ? `${r.minHours} hours or longer (shorter legs: Economy)` : 'Any flight'}</td>
                </tr>
              ))}
              <tr className="hover:bg-[var(--ecs-panel-2)]">
                <td className="td text-[var(--ecs-muted)]">Not in the register</td>
                <td className="td">Economy</td>
                <td className="td text-[var(--ecs-muted)]">Default entitlement</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* ---------------- Accommodation caps ---------------- */}
      <div className="grid md:grid-cols-2 gap-5">
        <Card title="Accommodation caps — by city">
          <p className="text-sm text-[var(--ecs-muted)] mb-3">A nightly rate above the cap is an <span className="pill-warn">exception</span> and needs a justification.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">City</th><th className="th text-right">Cap / night</th></tr></thead>
              <tbody>
                {hotelCaps.map((h) => (
                  <tr key={h.cityCode} className="hover:bg-[var(--ecs-panel-2)]">
                    <td className="td">{cityName(h.cityCode)}</td>
                    <td className="td text-right tabular-nums">SGD {h.capNightlySgd}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Accommodation caps — by country">
          <p className="text-sm text-[var(--ecs-muted)] mb-3">The country cap applies when a city has no specific cap.</p>
          <div className="overflow-x-auto max-h-80">
            <table className="w-full text-sm">
              <thead><tr><th className="th">Country</th><th className="th text-right">Cap / night</th></tr></thead>
              <tbody>
                {hotelCapsByCountry.map((h) => (
                  <tr key={h.countryCode} className="hover:bg-[var(--ecs-panel-2)]">
                    <td className="td">{countryName(h.countryCode)}</td>
                    <td className="td text-right tabular-nums">SGD {h.capNightlySgd}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* ---------------- ODA ---------------- */}
      <Card title="Overseas Daily Allowance (ODA)">
        <p className="text-sm text-[var(--ecs-muted)] mb-3">ODA is auto-calculated from the country rate and the length of stay; it excludes personal days. Longer trips step down by duration:</p>
        <div className="flex flex-wrap gap-2 mb-4 text-sm">
          <span className="pill-info">Days 1–{ODA_TIER1_END_DAY}: {ODA_TIER1_PCT}% of the daily rate</span>
          <span className="pill-info">Days {ODA_TIER1_END_DAY + 1}–{ODA_TIER2_END_DAY}: {ODA_TIER2_PCT}%</span>
          <span className="pill-info">Day {ODA_TIER2_END_DAY + 1}+: monthly allowance ÷ {ODA_MONTHLY_DAYS} per day</span>
        </div>
        <div className="overflow-x-auto max-h-80">
          <table className="w-full text-sm">
            <thead><tr><th className="th">Country</th><th className="th text-right">Daily rate</th><th className="th text-right">Monthly allowance</th></tr></thead>
            <tbody>
              {odaRates.map((o) => (
                <tr key={o.countryCode} className="hover:bg-[var(--ecs-panel-2)]">
                  <td className="td">{countryName(o.countryCode)}</td>
                  <td className="td text-right tabular-nums">SGD {o.dailyRateSgd}</td>
                  <td className="td text-right tabular-nums">SGD {o.monthlyRateSgd}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ---------------- Policy checks ---------------- */}
      <Card title="Policy checks">
        <p className="text-sm text-[var(--ecs-muted)] mb-3">The checks that run on a request, grouped by what they mean for you.</p>
        <div className="space-y-4">
          {ruleGroups.map((oc) => {
            const rules = policyRules.filter((r) => r.defaultOutcome === oc && r.active);
            if (!rules.length) return null;
            return (
              <div key={oc}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={outcomePill[oc]}>{oc === POLICY_OUTCOME.HardStop ? 'Hard stop' : oc === POLICY_OUTCOME.Exception ? 'Exception' : 'Warning'}</span>
                  <span className="text-xs text-[var(--ecs-muted)]">{outcomeLabel[oc]}</span>
                </div>
                <ul className="space-y-1.5">
                  {rules.map((r) => (
                    <li key={r.code} className="text-sm flex gap-2">
                      <span className="font-medium text-[var(--ecs-text)] shrink-0">{r.name}</span>
                      <span className="text-[var(--ecs-muted)]">— {r.description}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </Card>

      {/* ---------------- Booking & payment ---------------- */}
      <Card title="Booking &amp; payment">
        <ul className="text-sm text-[var(--ecs-muted)] space-y-1.5 list-disc pl-5">
          <li><strong>TMC booking.</strong> An approved request is handed to the appointed travel agent (TMC); airfare, and hotel where the requestor chose central settlement, are lodged to the <strong>Corporate Travel Account (CTA)</strong> — no out-of-pocket prepayment.</li>
          <li><strong>Self / external booking.</strong> You may book outside the TMC (including a non-NTU agent); that trip is <strong>self-paid and reimbursed</strong> through the expense claim.</li>
          <li><strong>Groups &amp; guests.</strong> A single request can cover a group or an external guest; guest airfare and accommodation are centrally settled.</li>
          <li><strong>GST.</strong> GST is applied to <strong>actual expenses</strong> at the claim and central posting stage — your pre-trip estimate is a gross figure with no GST added.</li>
        </ul>
      </Card>

      <p className="text-xs text-[var(--ecs-muted)]">Reference only. Caps, rates and entitlements are maintained in the ECS masters and consumed read-only here; the full technical catalogue is in the Configuration Viewer.</p>
    </div>
  );
}

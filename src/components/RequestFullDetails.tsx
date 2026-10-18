// Full detail sections of a Travel Request (the "source of truth" below the Approval Summary).
// Shared by the draft review (inline) and the dedicated Full Details page so there is one copy.
// The section anchors (sec-trip / sec-traveller / sec-exceptions / sec-cost) let the Approval
// Summary tiles deep-link straight to the relevant section.
import { sharedLegs } from '@/modules/pretrip/group';
import { hasGuestMembers } from '@/modules/pretrip/settlement';
import { GroupTravellers } from './GroupTravellers';
import { RequestActivity } from './RequestActivity';
import {
  SummaryCard, TravellerCard, GroupSummaryCard, TravellerRoster, ItineraryLegsCard,
  CostAllocationCard, PolicyExceptionsCard, CostItems, GuestSettlementCard,
} from './ReviewSections';
import type { FullRequest } from '@/modules/pretrip/queries';
import type { CostSummary } from '@/modules/pretrip/pricing';

export function RequestFullDetails({ req, summary, settings }: {
  req: FullRequest; summary: CostSummary; settings: { bookingDeadlineDays: number; approvalAmountBasis: string };
}) {
  const isMulti = sharedLegs(req).length > 2;
  return (
    <div className="space-y-5">
      <div id="sec-trip" className="scroll-mt-20"><SummaryCard req={req} bookingDeadlineDays={settings.bookingDeadlineDays} /></div>

      {/* Lettered cards (letters assigned in reading order) */}
      <div className="grid md:grid-cols-2 gap-5 items-start">
        <div id="sec-traveller" className="scroll-mt-20">{req.isGroup ? <GroupSummaryCard req={req} letter="A" /> : <TravellerCard req={req} letter="A" />}</div>
        <div id="sec-exceptions" className="scroll-mt-20"><PolicyExceptionsCard req={req} letter="B" /></div>
      </div>
      {req.isGroup && <TravellerRoster req={req} letter="C" />}
      {isMulti && <ItineraryLegsCard req={req} letter="C" />}

      <div id="sec-cost" className="scroll-mt-20"><CostItems req={req} summary={summary} basis={settings.approvalAmountBasis} letter={req.isGroup || isMulti ? 'D' : 'C'} /></div>

      <CostAllocationCard req={req} amount={summary.ntuFunded} letter={req.isGroup || isMulti ? 'E' : 'D'} />

      {/* §8 Guest settlement (host direct-billed) — self-hides when there is no guest cost. */}
      {hasGuestMembers(req) && <GuestSettlementCard req={req} letter={req.isGroup ? 'F' : 'E'} />}

      {/* Group management workbench (confirmations, per-traveller class & sub-itineraries) */}
      {req.isGroup && (
        <details className="group">
          <summary className="card px-4 py-3 cursor-pointer select-none flex items-center gap-2 font-semibold text-[var(--ecs-navy)] list-none">
            <span className="transition-transform group-open:rotate-90">▸</span> Group Management — confirmations, per-traveller class &amp; sub-itineraries
          </summary>
          <div className="mt-3"><GroupTravellers req={req} /></div>
        </details>
      )}

      <RequestActivity req={req} />
    </div>
  );
}

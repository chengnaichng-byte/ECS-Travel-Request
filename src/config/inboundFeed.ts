// §7.3 / §13.9 Canonical INBOUND-FEED requirements — the datapoints the TMC must return on the
// TA-keyed booking feed, independent of any one request. The feed lands in the Pre-Trip module
// (receiveBooking) and fans to TWO consumers: the Pre-Trip booking + CTA→SAP posting branch
// (DD-30/31), and the ECS Expense Claim (TE) pre-population branch (§13.8). This is the contract
// requirements table rendered on TR-20 above the per-request live preview.

export type FeedConsumer = 'PRETRIP' | 'CTA_SAP' | 'TE_CLAIM';

export const FEED_CONSUMER_LABEL: Record<FeedConsumer, string> = {
  PRETRIP: 'Pre-Trip booking',
  CTA_SAP: 'CTA → SAP',
  TE_CLAIM: 'ECS claim',
};

export interface InboundFeedField {
  datapoint: string;
  field: string;                 // canonical contract field (src/integrations/tmc/contract.ts)
  consumers: FeedConsumer[];
  requirement: 'Mandatory' | 'Conditional' | 'Optional';
  purpose: string;
}
export interface InboundFeedGroup { group: string; note?: string; fields: InboundFeedField[]; }

export const INBOUND_FEED_SPEC: InboundFeedGroup[] = [
  {
    group: 'Booking confirmation',
    fields: [
      { datapoint: 'Travel Authorisation no. (feed anchor)', field: 'authorisationNumber', consumers: ['PRETRIP', 'TE_CLAIM'], requirement: 'Mandatory', purpose: 'The TA the feed is retrieved by — one TA returns every PNR under it (one TR → N PNRs). A response with no valid TA is rejected.' },
      { datapoint: 'PNR + supplier code (PNR key)', field: 'pnr · supplierCode', consumers: ['PRETRIP', 'CTA_SAP', 'TE_CLAIM'], requirement: 'Mandatory', purpose: 'Booking record locator. The key is (supplierCode, pnr) — a locator is unique only within its owning GDS/supplier. Carried into the claim as the booking reference.' },
      { datapoint: 'E-ticket numbers', field: 'ticketNumbers[]', consumers: ['PRETRIP', 'TE_CLAIM'], requirement: 'Conditional', purpose: 'Issued e-tickets (air). Present once ticketed.' },
      { datapoint: 'Booking status (OBT)', field: 'bookingStatus', consumers: ['PRETRIP'], requirement: 'Mandatory', purpose: 'Industry OBT/TMC status (IN_PROGRESS…TICKETED…CANCELLED). ECS maps it to its own lifecycle (obtToEcsBookingStatus); also gates the inbound-accept guard.' },
      { datapoint: 'Fulfilment channel', field: 'channel', consumers: ['PRETRIP'], requirement: 'Optional', purpose: 'Online / agent-assisted / offline — the channel that fulfilled the booking.' },
      { datapoint: 'Booked / ticketed timestamps', field: 'bookedAt · ticketedAt', consumers: ['PRETRIP', 'CTA_SAP'], requirement: 'Conditional', purpose: 'Confirmation / ticket-issue times — a charge may post to SAP only once ticketed.' },
      { datapoint: 'Booked cabin class', field: 'segments[].bookedClass', consumers: ['PRETRIP', 'TE_CLAIM'], requirement: 'Mandatory', purpose: 'The actual class booked — compared to the approved class to raise a booking deviation (§6.4).' },
      { datapoint: 'Booked travel dates', field: 'segments[].departDate / arriveDate', consumers: ['PRETRIP', 'TE_CLAIM'], requirement: 'Mandatory', purpose: 'DD-17 booked depart / arrival dates, persisted on the segment.' },
      { datapoint: 'Supplier (airline / hotel)', field: 'segments[].supplierName / supplierCode / confirmationNo', consumers: ['PRETRIP'], requirement: 'Optional', purpose: 'Airline / hotel name + code (and hotel confirmation no.) for reconciliation.' },
    ],
  },
  {
    group: 'Association keys — segment → PNR → TA trace',
    note: 'How a charge/segment is tied back up the hierarchy so finance can walk it to the exact flight, PNR and TA.',
    fields: [
      { datapoint: 'Segment ref', field: 'segments[].segmentRef', consumers: ['PRETRIP', 'CTA_SAP'], requirement: 'Conditional', purpose: 'Stable per-segment id within the feed; charges reference it.' },
      { datapoint: 'Owning PNR', field: 'segments[].pnr', consumers: ['PRETRIP', 'CTA_SAP'], requirement: 'Conditional', purpose: 'The PNR a segment sits under (a TA may span several PNRs).' },
      { datapoint: 'GDS segment status', field: 'segments[].segmentStatus', consumers: ['PRETRIP'], requirement: 'Optional', purpose: 'Air: GDS action/advice code (HK confirmed / UN cancelled / TK sched-change …).' },
      { datapoint: 'Ticket + coupon', field: 'segments[].ticketNumber / couponNumber', consumers: ['PRETRIP', 'CTA_SAP'], requirement: 'Conditional', purpose: 'Air: the e-ticket + coupon (flight sequence) covering the segment.' },
    ],
  },
  {
    group: 'CTA charges — the SAP posting (DD-30 / DD-31)',
    note: 'The authoritative per-charge basis ECS posts to SAP on receipt (Dr expense ⇄ Cr CTA clearing).',
    fields: [
      { datapoint: 'CTA account + card', field: 'ctaAccountId · ctaCardRef', consumers: ['CTA_SAP'], requirement: 'Mandatory', purpose: 'The CTA card the central charges hit → credit (clearing) GL via the CTA master; masked card ref for statement reconciliation.' },
      { datapoint: 'Settlement + charge date + period', field: 'ctaCharged · ctaChargeDate · statementPeriod', consumers: ['CTA_SAP'], requirement: 'Mandatory', purpose: 'A charge posts only once settled on the CTA; the billing period reconciles to the card statement.' },
      { datapoint: 'Provider invoice no.', field: 'invoiceNumber', consumers: ['CTA_SAP'], requirement: 'Mandatory', purpose: 'SAP posting Reference for the journal (the PNR is used when absent).' },
      { datapoint: 'Per-charge breakdown', field: 'charges[].type / expenseTypeId / amountSgd', consumers: ['CTA_SAP'], requirement: 'Mandatory', purpose: 'One Dr posting line per charge; the expense-type master gives the GL (the agency fee is its own line, never folded into the zero-rated airfare).' },
      { datapoint: 'Per-charge tax code + GST', field: 'charges[].gstCode / gstAmountSgd / gstClaimable', consumers: ['CTA_SAP'], requirement: 'Mandatory', purpose: 'SAP tax code (IZ / IO / I9 / P9) + external tax amount; the I9 ↔ P9 fork follows the charging-account GST-claimable flag.' },
      { datapoint: 'Charge → ticket link', field: 'charges[].pnr / ticketNumber / segmentRef', consumers: ['CTA_SAP'], requirement: 'Conditional', purpose: 'Ties each posting line to the e-ticket / segment / PNR it settled (charge → fulfilment trace).' },
      { datapoint: 'Original currency + FX', field: 'charges[].currency / foreignAmount / fxRate', consumers: ['CTA_SAP'], requirement: 'Optional', purpose: 'Audit for a foreign-currency booking (ECS posts the SGD amount).' },
    ],
  },
  {
    group: 'Booked actuals (estimate-to-actual)',
    fields: [
      { datapoint: 'Booked amounts', field: 'fareSgd · taxesSgd · feesSgd', consumers: ['PRETRIP', 'TE_CLAIM'], requirement: 'Mandatory', purpose: 'Estimate-to-actual comparison (§13.17); carried into the claim as actuals (reference-only for central/CTA lines).' },
    ],
  },
  {
    group: 'Cancellation & change',
    fields: [
      { datapoint: 'Cancellation / refund', field: 'cancellation.cancelledAt / reason / cancellationFeeSgd / refundSgd', consumers: ['PRETRIP', 'CTA_SAP'], requirement: 'Conditional', purpose: 'Drives the CTA reversal — the refund reverses the posting, the non-refundable penalty stays a charge.' },
      { datapoint: 'Change / reissue', field: 'reissue.reissuedAt / changeFeeSgd / newPnr / newTicketNumbers', consumers: ['PRETRIP', 'CTA_SAP'], requirement: 'Conditional', purpose: 'Change fee + new reference when a booking is amended, reconciled against the approved request (§6.4).' },
    ],
  },
];

// §37 Notifications. The prototype derives an in-app notification feed AND a mock email
// outbox from the real AuditEvent stream, so notifications reflect what actually happened
// (a working prototype, not a scripted list). Each item deep-links to its request.
import { prisma } from '@/shared/db';
import { EcsIdentity } from '@/shared/ecs/services';
import { travellerName } from './traveller';

export interface NotificationItem {
  id: string;
  at: Date;
  requestId: string | null;
  requestNumber: string;
  kind: string;
  title: string;
  detail: string;
  recipient: string;        // who is notified in-app
  email: { to: string; subject: string } | null;  // the mock email this event would send
}

// Which audit kinds surface as notifications, and how to title them.
const NOTIFY_KINDS = new Set(['SUBMIT', 'APPROVE', 'REJECT', 'SENDBACK', 'STATUS', 'INTEGRATION', 'TE_LINK']);

function titleFor(kind: string): string {
  switch (kind) {
    case 'SUBMIT': return 'Request submitted for approval';
    case 'APPROVE': return 'Approval step completed';
    case 'REJECT': return 'Request rejected';
    case 'SENDBACK': return 'Request sent back';
    case 'STATUS': return 'Status update';
    case 'INTEGRATION': return 'Booking / integration update';
    case 'TE_LINK': return 'Expense claim update';
    default: return 'Update';
  }
}

export async function listNotifications(limit = 40): Promise<NotificationItem[]> {
  const events = await prisma.auditEvent.findMany({
    where: { kind: { in: [...NOTIFY_KINDS] }, requestId: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { request: { select: { requestNumber: true, requestorId: true, travellerId: true, travellerType: true, guestName: true, guestEmail: true } } },
  });

  return events.filter((e) => e.request).map((e) => {
    const req = e.request!;
    const traveller = travellerName(req);
    const requestor = EcsIdentity.employee(req.requestorId)?.name ?? req.requestorId;
    // Recipient + whether a mock email goes out, by event kind.
    let recipient = requestor;
    let email: { to: string; subject: string } | null = null;
    const emailAddr = req.travellerType === 'GUEST' ? (req.guestEmail ?? 'guest') : `${(EcsIdentity.employee(req.travellerId)?.name ?? 'traveller').toLowerCase().replace(/[^a-z]+/g, '.')}@ntu.edu.sg`;
    switch (e.kind) {
      case 'SUBMIT': recipient = 'Next approver in the route'; email = { to: 'approver@ntu.edu.sg', subject: `Action required: approve ${req.requestNumber}` }; break;
      case 'APPROVE': recipient = `${traveller} (traveller)`; email = { to: emailAddr, subject: `Your request ${req.requestNumber} progressed` }; break;
      case 'REJECT': recipient = `${requestor} (requestor)`; email = { to: emailAddr, subject: `${req.requestNumber} was rejected` }; break;
      case 'SENDBACK': recipient = `${requestor} (requestor)`; email = { to: emailAddr, subject: `${req.requestNumber} sent back for changes` }; break;
      case 'STATUS':
        if (/High-risk travel/.test(e.summary)) { recipient = 'Risk Management Office'; email = { to: 'risk-office@ntu.edu.sg', subject: `High-risk travel notification — ${req.requestNumber}` }; }
        else if (/Visa letter notification sent/.test(e.summary)) { recipient = 'Immigration & Passes Office'; email = { to: 'immigration@ntu.edu.sg', subject: `Visa letter — ${req.requestNumber}` }; }
        else { recipient = `${traveller} (traveller)`; email = /Travel Authorisation/.test(e.summary) ? { to: emailAddr, subject: `Travel Authorisation issued — ${req.requestNumber}` } : null; }
        break;
      case 'INTEGRATION': recipient = 'Travel Administrator / traveller'; email = /sent to TMC|retransmit/.test(e.summary) ? { to: 'tmc@agency.example', subject: `Booking instruction — ${req.requestNumber}` } : null; break;
      case 'TE_LINK': recipient = `${traveller} (claimant)`; email = null; break;
    }
    return {
      id: e.id, at: e.createdAt, requestId: e.requestId, requestNumber: req.requestNumber,
      kind: e.kind, title: titleFor(e.kind), detail: e.summary, recipient, email,
    };
  });
}

// §13.21 Comments + Attachments panels and header actions — mirrors the TE claim
// experience (Figure D8). The comments feed combines system workflow events (from the
// audit trail / status transitions) and user comments in one chronological stream.
import { EcsIdentity } from '@/shared/ecs/services';
import { addComment, addAttachment } from '@/modules/pretrip/actions';
import { Card } from './ui';
import type { FullRequest } from '@/modules/pretrip/queries';

const KIND_LABEL: Record<string, string> = {
  CREATE: 'Created', SUBMIT: 'Submitted', APPROVE: 'Approved', REJECT: 'Rejected', SENDBACK: 'Sent back',
  AMEND: 'Amendment', INTEGRATION: 'Booking', TE_LINK: 'TE linked', STATUS: 'Status', COMMENT: 'Comment',
};
function email(id?: string | null) {
  const n = EcsIdentity.employee(id ?? '')?.name;
  if (!n) return id ?? 'system';
  return `${n.replace(/^(Dr|Prof|Mr|Ms|Mrs)\s+/i, '').toLowerCase().replace(/\s+/g, '.')}@ntu.edu.sg`;
}
function ts(d: Date) { return d.toISOString().replace('T', ' ').slice(0, 19); }

export function RequestActivity({ req }: { req: FullRequest }) {
  const feed = [...req.auditEvents].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return (
    <div className="space-y-5">
      <div className="grid md:grid-cols-2 gap-5">
        {/* Comments feed */}
        <Card title="Comments">
          <ol className="space-y-3 mb-4">
            {feed.map((e) => (
              <li key={e.id} className="flex gap-3 text-sm">
                <div className="text-[11px] text-[var(--ecs-muted)] w-14 shrink-0 pt-0.5">{e.createdAt.toISOString().slice(5, 10)}</div>
                <div className="border-l border-[var(--ecs-border)] pl-3">
                  <div className="font-medium text-[var(--ecs-navy)]">{EcsIdentity.employee(e.actorId ?? '')?.name ?? 'System'} <span className="text-[var(--ecs-muted)] font-normal">({email(e.actorId)})</span></div>
                  <div className="text-xs text-[var(--ecs-muted)]">{ts(e.createdAt)} · {KIND_LABEL[e.kind] ?? e.kind}</div>
                  <div className="text-[13px]">{e.summary}</div>
                </div>
              </li>
            ))}
          </ol>
          <form action={addComment.bind(null, req.id)} className="flex items-end gap-2">
            <textarea name="comment" rows={2} className="field" placeholder="Add a comment…" />
            <button className="btn-primary shrink-0">＋ Add comment</button>
          </form>
        </Card>

        {/* Attachments */}
        <Card title="Attachment">
          <form action={addAttachment.bind(null, req.id)} className="grid grid-cols-2 gap-2 items-end mb-3">
            <div>
              <label className="label">Document type</label>
              <select name="docType" className="field">
                <option>Quotation</option><option>Conference Invitation</option><option>Approval Evidence</option><option>Other</option>
              </select>
            </div>
            <div>
              <label className="label">File</label>
              <input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" className="field" />
            </div>
            <div className="col-span-2"><button className="btn-primary">＋ Upload Attachment</button></div>
          </form>
          <table className="w-full text-sm">
            <thead><tr><th className="th">Document type</th><th className="th">File name</th><th className="th">Size</th><th className="th">Uploaded by</th></tr></thead>
            <tbody>
              {req.attachments.length === 0 ? (
                <tr><td className="td text-[var(--ecs-muted)] italic" colSpan={4}>No items to show…</td></tr>
              ) : req.attachments.map((a) => (
                <tr key={a.id}>
                  <td className="td">{a.docType}</td>
                  <td className="td">{a.content ? <a href={`/requests/${req.id}/attachments/${a.id}`} target="_blank" rel="noopener" className="text-[var(--ecs-navy)] hover:underline">{a.fileName}</a> : a.fileName}</td>
                  <td className="td">{a.sizeKb} KB</td>
                  <td className="td">{EcsIdentity.employee(a.uploadedById ?? '')?.name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-[var(--ecs-muted)] mt-2 font-semibold">Maximum of 7 files allowed, total size limit: 7 MB. Supported formats: PNG, JPEG, PDF.</p>
        </Card>
      </div>
    </div>
  );
}

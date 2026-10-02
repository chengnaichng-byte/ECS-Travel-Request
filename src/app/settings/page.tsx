// TR-19 Pre-Trip Module Settings — the only editable configuration screen in the
// prototype (§13.18). Toggling a switch and resubmitting a request demonstrates
// configuration-driven behaviour (AC03). Common ECS policy stays in ECS config.
import { getSettings } from '@/modules/pretrip/settings';
import { decisionCatalogue } from '@/config/decisions';
import { saveModuleSettings } from '@/app/actions';
import { PageTitle, Card } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const s = (await getSettings()) as unknown as Record<string, unknown>;

  return (
    <div className="max-w-3xl">
      <PageTitle id="TR-19" title="Pre-Trip Module Settings"
        subtitle="Module-specific decision switches (§3.4). These are runtime-togglable and drive routing, policy and claim behaviour without a rebuild — the OutSystems equivalent is a set of site properties." />

      <form action={saveModuleSettings}>
        <Card title="Configurable Decisions (§3.4)">
          <div className="space-y-4">
            {decisionCatalogue.map((d) => (
              <div key={d.key} className="flex items-start justify-between gap-4 pb-3 border-b border-[var(--ecs-border)] last:border-0">
                <div className="max-w-md">
                  <div className="text-sm font-medium">{d.label}</div>
                  <div className="text-xs text-[var(--ecs-muted)] mt-0.5">{d.effect}</div>
                </div>
                <div className="shrink-0">
                  {d.kind === 'boolean' ? (
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" name={d.key} defaultChecked={Boolean(s[d.key])} className="w-4 h-4" />
                      <span className="text-sm text-[var(--ecs-muted)]">Enabled</span>
                    </label>
                  ) : d.kind === 'number' ? (
                    <input type="number" name={d.key} defaultValue={Number(s[d.key])} className="field w-48" />
                  ) : (
                    <select name={d.key} defaultValue={String(s[d.key])} className="field w-48">
                      {'options' in d && d.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Authorisation Validity (§13.3)" className="mt-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Authorisation validity (days after return)</label>
              <input type="number" name="authorisationValidityDays" defaultValue={Number(s.authorisationValidityDays)} className="field" />
            </div>
            <div>
              <label className="label">Booking deadline (days before departure)</label>
              <input type="number" name="bookingDeadlineDays" defaultValue={Number(s.bookingDeadlineDays)} className="field" />
            </div>
          </div>
        </Card>

        <Card title="Thresholds, Limits & Transport (§43)" className="mt-5">
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="label">Self-approval limit (SGD; 0 = never)</label>
              <input type="number" name="selfApprovalLimitSgd" defaultValue={Number(s.selfApprovalLimitSgd)} className="field" />
            </div>
            <div>
              <label className="label">Attachment max size (MB)</label>
              <input type="number" name="attachmentMaxMb" defaultValue={Number(s.attachmentMaxMb)} className="field" />
            </div>
            <div>
              <label className="label">Charging entry mode (§17)</label>
              <select name="chargingSplitMode" defaultValue={String(s.chargingSplitMode)} className="field">
                <option value="PERCENT">Percent</option>
                <option value="AMOUNT">Amount (SGD)</option>
              </select>
            </div>
            <div className="md:col-span-3">
              <label className="label">TMC transport / SFTP configuration</label>
              <input name="sftpConfig" defaultValue={String(s.sftpConfig ?? '')} className="field" />
            </div>
            <div className="md:col-span-3">
              <label className="label">Declaration text (shown on Review, §13.13)</label>
              <textarea name="declarationText" rows={2} defaultValue={String(s.declarationText ?? '')} className="field" />
            </div>
            <div className="md:col-span-3">
              <label className="label">Conflict-of-interest declaration text</label>
              <textarea name="coiText" rows={2} defaultValue={String(s.coiText ?? '')} className="field" />
            </div>
          </div>
        </Card>

        <div className="mt-5 flex justify-end">
          <button type="submit" className="btn-primary">Save settings</button>
        </div>
      </form>
    </div>
  );
}

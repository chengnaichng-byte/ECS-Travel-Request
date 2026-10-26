// DD-30 CTA Accounts — Setup & Maintenance. The Central Travel Account master (CTA → credit-GL
// clearing). Admin can add an account, edit its attributes (the feed key is fixed — it identifies
// the card), and activate / deactivate it. The CTA Charges view and the posting programme resolve
// each charge's credit GL through this master.
import { listCtaAccounts } from '@/modules/pretrip/ctaMaster';
import { createCtaAction, updateCtaAction, toggleCtaAction } from './actions';
import { currentPersona } from '@/shared/session';
import { ROLE } from '@/shared/enums';
import { PageTitle, Card } from '@/components/ui';

export const dynamic = 'force-dynamic';

const FIELD = (label: string, name: string, value: string, disabled: boolean, extra?: string) => (
  <div>
    <label className="label">{label}</label>
    <input name={name} defaultValue={value} disabled={disabled} className={`field ${extra ?? ''}`} />
  </div>
);

export default async function CtaAccountsPage() {
  const persona = await currentPersona();
  const isAdmin = persona.roles.includes(ROLE.TravelAdmin) || persona.roles.includes(ROLE.SystemAdmin);
  const rows = await listCtaAccounts();

  return (
    <div className="w-full space-y-5">
      <PageTitle id="DD-30" title="CTA Accounts — Central Travel Account master"
        subtitle="The CTA → credit-GL (clearing) accounts. The feed reports which CTA account each central charge hit; this master maps it to the clearing GL the posting programme credits. Add / edit / deactivate below; the CTA Charges view resolves each charge's credit GL from here." />

      {!isAdmin && <div className="card p-3 text-sm text-amber-800 bg-amber-50 border-amber-200">Switch persona to <strong>David Kumar — Travel Administrator</strong> (or System Administrator) to maintain the list. It is read-only for other roles.</div>}

      <Card title={`Central Travel Accounts (${rows.length})`}>
        <div className="space-y-3">
          {rows.map((a) => (
            <form key={a.id} action={updateCtaAction.bind(null, a.id)} className="border border-[var(--ecs-border)] rounded-lg p-3">
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <span className="font-mono text-sm text-[var(--ecs-navy)] font-semibold">{a.ctaAccountId}</span>
                <span className="text-xs text-[var(--ecs-muted)]">feed key · fixed</span>
                {a.active ? <span className="pill-pass">Active</span> : <span className="pill-stop">Inactive</span>}
                {isAdmin && (
                  <div className="ml-auto flex items-center gap-2">
                    <button className="btn-primary text-xs">Save</button>
                    <button formAction={toggleCtaAction.bind(null, a.id, !a.active)} className="btn-ghost text-xs">{a.active ? 'Deactivate' : 'Reactivate'}</button>
                  </div>
                )}
              </div>
              <div className="grid md:grid-cols-3 gap-3">
                {FIELD('Label', 'label', a.label, !isAdmin)}
                {FIELD('Provider', 'provider', a.provider, !isAdmin)}
                {FIELD('Credit GL (clearing)', 'clearingGlAccount', a.clearingGlAccount, !isAdmin, 'font-mono')}
                {FIELD('Company code', 'companyCode', a.companyCode, !isAdmin)}
                {FIELD('Currency', 'currency', a.currency, !isAdmin)}
                {FIELD('Effective from', 'effectiveFrom', a.effectiveFrom, !isAdmin)}
              </div>
            </form>
          ))}
        </div>
      </Card>

      {isAdmin && (
        <Card title="Add a CTA account">
          <form action={createCtaAction} className="space-y-3">
            <div className="grid md:grid-cols-3 gap-3">
              <div>
                <label className="label">CTA account (feed key)</label>
                <input name="ctaAccountId" placeholder="CTA-SG-XXX" className="field font-mono" />
              </div>
              {FIELD('Label', 'label', '', false)}
              {FIELD('Provider', 'provider', '', false)}
              <div>
                <label className="label">Credit GL (clearing)</label>
                <input name="clearingGlAccount" placeholder="199xxx" className="field font-mono" />
              </div>
              <div>
                <label className="label">Company code</label>
                <input name="companyCode" defaultValue="1000" className="field" />
              </div>
              <div>
                <label className="label">Currency</label>
                <input name="currency" defaultValue="SGD" className="field" />
              </div>
              <div>
                <label className="label">Effective from</label>
                <input name="effectiveFrom" placeholder="2025-01-01" className="field" />
              </div>
            </div>
            <button className="btn-primary">Add CTA account</button>
          </form>
          <p className="text-xs text-[var(--ecs-muted)] mt-2">The feed key is the account id the card / TMC reports on each charge (never derived). Adding a key that already exists updates and reactivates it. Different CTA accounts should map to different clearing GLs.</p>
        </Card>
      )}
    </div>
  );
}

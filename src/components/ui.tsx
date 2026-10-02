// Small presentational helpers shared across screens.
import Link from 'next/link';

// §13.22 section title band — navy with white title and right-aligned action links.
export function PageTitle({ id, title, subtitle, actions }: { id?: string; title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="section-band">
        <div>
          {id && <div className="text-[11px] font-semibold text-white/70 uppercase tracking-wide">{id}</div>}
          <h1 className="text-lg font-semibold text-white">{title}</h1>
        </div>
        {actions && <div className="band-actions flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {subtitle && <p className="text-sm text-[var(--ecs-muted)] mt-2 max-w-3xl">{subtitle}</p>}
    </div>
  );
}

export function Card({ title, children, actions, className = '' }: { title?: string; children: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {title && (
        <div className="card-head flex items-center justify-between">
          <span>{title}</span>
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-[var(--ecs-muted)] uppercase tracking-wide">{label}</dt>
      <dd className="text-sm mt-0.5">{children ?? '—'}</dd>
    </div>
  );
}

const STEPS = [
  { key: 'traveller', label: 'Traveller' },
  { key: 'trip', label: 'Trip' },
  { key: 'estimates', label: 'Estimates' },
  { key: 'charging', label: 'Charging' },
  { key: 'policy', label: 'Policy Review' },
  { key: 'review', label: 'Submit' },
];

export function Stepper({ id, active }: { id: string; active: string }) {
  const activeIdx = STEPS.findIndex((s) => s.key === active);
  return (
    <ol className="flex items-center gap-1 mb-5 flex-wrap">
      {STEPS.map((s, i) => {
        const done = i < activeIdx;
        const isActive = i === activeIdx;
        const href = s.key === 'traveller' ? `/requests/${id}` : `/requests/${id}/${s.key}`;
        return (
          <li key={s.key} className="flex items-center">
            <Link
              href={href}
              className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm border ${
                isActive ? 'bg-[var(--ecs-navy)] text-white border-[var(--ecs-navy)]'
                : done ? 'bg-[var(--ecs-panel)] text-[var(--ecs-navy-2)] border-[var(--ecs-border)]'
                : 'bg-white text-[var(--ecs-muted)] border-[var(--ecs-border)]'
              }`}
            >
              <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs ${isActive ? 'bg-white text-[var(--ecs-navy)]' : done ? 'bg-[var(--ecs-navy)] text-white' : 'bg-[var(--ecs-panel-2)]'}`}>
                {done ? '✓' : i + 1}
              </span>
              {s.label}
            </Link>
            {i < STEPS.length - 1 && <span className="mx-0.5 text-[var(--ecs-border)]">→</span>}
          </li>
        );
      })}
    </ol>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-[var(--ecs-muted)] italic py-6 text-center">{children}</div>;
}

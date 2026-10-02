// §13.20 compact horizontal leg timeline — origin/destination chips with dates and
// grey connectors, consistent with the chevron language (§13.22 permitted enhancement).
import { EcsReference } from '@/shared/ecs/services';

interface Leg { seq: number; originCode: string; destCode: string; departDate: Date | null; isPersonal: boolean }

function label(code: string) {
  return EcsReference.airport(code)?.code ?? code;
}
function fmt(d: Date | null) { return d ? d.toISOString().slice(5, 10) : ''; }

export function LegTimeline({ legs }: { legs: Leg[] }) {
  const ordered = [...legs].sort((a, b) => a.seq - b.seq);
  if (ordered.length === 0) return null;
  return (
    <div className="flex items-center flex-wrap gap-1.5">
      <span className="leg-chip">{label(ordered[0].originCode)}</span>
      {ordered.map((l) => (
        <span key={l.seq} className="flex items-center gap-1.5">
          <span className="leg-conn" />
          <span className="text-[10px] text-[var(--ecs-muted)]">{fmt(l.departDate)}</span>
          <span className="leg-conn" />
          <span className={`leg-chip ${l.isPersonal ? 'opacity-60 italic' : ''}`}>{label(l.destCode)}{l.isPersonal ? ' ·personal' : ''}</span>
        </span>
      ))}
    </div>
  );
}

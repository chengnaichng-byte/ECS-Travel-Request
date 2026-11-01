// Field-provenance legend (pilot). Defines the form's visual language: where each value comes from
// and whether it can be changed. Colour is always paired with a chip and this legend — never colour
// alone. Three states: Entered (user typed/chose), Default (pre-filled, editable), Derived (locked).
export function ProvenanceLegend({ className = '' }: { className?: string }) {
  return (
    <div className={`card p-3 ${className}`}>
      <div className="prov-legend text-xs text-[var(--ecs-muted)]">
        <span className="font-semibold text-[var(--ecs-navy)]">How to read this form:</span>
        <span className="inline-flex items-center gap-1.5"><span className="prov-tag prov-tag-entered">Entered</span> you typed or chose it</span>
        <span className="inline-flex items-center gap-1.5"><span className="prov-tag prov-tag-resolved">Default</span> pre-filled, editable — you can override</span>
        <span className="inline-flex items-center gap-1.5"><span className="prov-tag prov-tag-derived">Derived</span> computed, locked</span>
      </div>
    </div>
  );
}

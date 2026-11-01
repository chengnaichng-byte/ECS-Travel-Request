// Field-provenance legend. Defines the form's visual language: where each value comes from and
// whether it can be changed. The value text itself is coloured by state (blue = editable default,
// muted = computed/locked); the common "Entered" case stays the baseline colour. Colour is always
// paired with this legend, never colour alone.
export function ProvenanceLegend({ className = '' }: { className?: string }) {
  return (
    <div className={`card p-3 ${className}`}>
      <div className="prov-legend text-xs text-[var(--ecs-muted)]">
        <span className="font-semibold text-[var(--ecs-navy)]">How to read this form:</span>
        <span className="prov-key prov-key-entered"><span className="font-semibold">Entered</span> — you typed or chose it</span>
        <span className="prov-key prov-key-default"><span className="font-semibold txt-default">Default</span> — pre-filled, editable (you can override)</span>
        <span className="prov-key prov-key-derived"><span className="font-semibold txt-derived">Derived</span> — computed, locked</span>
      </div>
    </div>
  );
}

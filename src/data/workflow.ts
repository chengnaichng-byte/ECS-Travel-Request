// §13.7 Workflow amount bands + research variant. §2.3: the workflow evaluator
// accepts module, workflow type, amount basis and request context as inputs and
// picks a DOA tier from the amount band; the pre-trip module extends the existing
// ECS workflow engine rather than creating a parallel one.

export interface WorkflowBand {
  id: string;
  minSgd: number;
  maxSgd: number | null;   // null = no upper bound
  doaTierIndex: number;    // index into department.doaLine (0-based)
  label: string;
}

// §13.7 DOA amount bands pick the DOA tier (pre-trip has no RO step): 0–5,000 → DOA-1;
// 5,001–20,000 → DOA-2; above 20,000 → DOA-3.
export const workflowBands: WorkflowBand[] = [
  { id: 'BAND-A', minSgd: 0,      maxSgd: 5000,  doaTierIndex: 0, label: 'SGD 0 – 5,000 (DOA-1)' },
  { id: 'BAND-B', minSgd: 5000.01, maxSgd: 20000, doaTierIndex: 1, label: 'SGD 5,001 – 20,000 (DOA-2)' },
  { id: 'BAND-C', minSgd: 20000.01, maxSgd: null,  doaTierIndex: 2, label: 'Above SGD 20,000 (DOA-3)' },
];

export function bandForAmount(amountSgd: number): WorkflowBand {
  return workflowBands.find((b) => amountSgd >= b.minSgd && (b.maxSgd === null || amountSgd <= b.maxSgd)) ?? workflowBands[workflowBands.length - 1];
}

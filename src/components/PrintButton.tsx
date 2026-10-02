'use client';
// §24 Approval-pack print trigger — the browser's Print → Save as PDF produces the file.
export function PrintButton() {
  return <button onClick={() => window.print()} className="btn-primary">⭳ Print / Save as PDF</button>;
}

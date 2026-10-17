export interface PinRow {
  ours_id: string;
  theirs_id: string;
}

/** Writes pins as manual.csv text that parseManual reads back unchanged. */
export function formatManual(pins: PinRow[]): string {
  const field = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  return ['ours_id,theirs_id', ...pins.map((p) => `${field(p.ours_id)},${field(p.theirs_id)}`)].join('\n') + '\n';
}

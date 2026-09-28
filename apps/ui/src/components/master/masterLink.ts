// Master & QC's deep link (delivery-platform-profiles.prd.md Phase 9, P12; stage navigation Phase 8): a delivery finding on Proof
// has no manuscript position or REAPER item, so "go to" opens Master & QC on its file and rule instead. Like the other deep links
// (App.tsx), it is an anchor on the fixed page path: /master#file=<path>&rule=<rule id>. The retired /delivery route redirects here
// keeping the anchor, so an older link still lands.

export type MasterFocus = { file: string; rule?: string };

/** The anchor that opens Master & QC on a file, and on one of its rules. */
export function masterHash(focus: MasterFocus): string {
  return `#${new URLSearchParams({ file: focus.file, ...(focus.rule ? { rule: focus.rule } : {}) }).toString()}`;
}

/** The file and rule an anchor names, or nothing when it names no file. */
export function parseMasterHash(hash: string): MasterFocus | undefined {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const file = params.get('file');
  if (!file) return undefined;
  const rule = params.get('rule');
  return rule ? { file, rule } : { file };
}

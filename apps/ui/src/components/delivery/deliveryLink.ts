// The Delivery page's deep link (delivery-platform-profiles.prd.md Phase 9, P12): a delivery finding on the Review page has no
// manuscript position or REAPER item, so "go to" opens the Delivery page on its file and rule instead. Like the other deep links
// (App.tsx), it is an anchor on the fixed page path: /delivery#file=<path>&rule=<rule id>.

export type DeliveryFocus = { file: string; rule?: string };

/** The anchor that opens the Delivery page on a file, and on one of its rules. */
export function deliveryHash(focus: DeliveryFocus): string {
  return `#${new URLSearchParams({ file: focus.file, ...(focus.rule ? { rule: focus.rule } : {}) }).toString()}`;
}

/** The file and rule an anchor names, or nothing when it names no file. */
export function parseDeliveryHash(hash: string): DeliveryFocus | undefined {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const file = params.get('file');
  if (!file) return undefined;
  const rule = params.get('rule');
  return rule ? { file, rule } : { file };
}

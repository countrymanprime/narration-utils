import type { CreditsRenderResult } from './api/contracts/credits';

/**
 * Splits a rendered credits text on every unresolved token's own bracketed placeholder ("[Author]") so a caller can
 * render each occurrence with a highlighted chip in place, matching Open Question C6: "a highlighted placeholder
 * chip and an unresolved-token count", never silently rendered as empty text (PRD audiobook-credits-templates.prd.md).
 *
 * One function backs every surface that shows a credits preview (Settings > Credits, Phase 1; the Manuscript
 * pseudo-entries, Phase 3), so an unresolved token looks and is found the same way everywhere.
 */
export function previewParts(result: CreditsRenderResult): (string | { token: string })[] {
  if (result.unresolved.length === 0) return [result.text];
  const pattern = new RegExp(`\\[(${result.unresolved.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\]`, 'g');
  const parts: (string | { token: string })[] = [];
  let lastIndex = 0;
  for (const match of result.text.matchAll(pattern)) {
    if (match.index === undefined) continue;
    if (match.index > lastIndex) parts.push(result.text.slice(lastIndex, match.index));
    parts.push({ token: match[1] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < result.text.length) parts.push(result.text.slice(lastIndex));
  return parts;
}

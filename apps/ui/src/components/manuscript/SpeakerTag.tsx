// The reader's speaker-attribution chip (prep-depth.prd.md Phase 4): reuses the `Character` highlight tokens
// (Highlight.tsx) rather than a new colour per speaker, so no design-token decision is needed for this phase -
// every resolved speaker reads in the same tone the Story Bible already uses for a Character mention.
export function SpeakerTag({ label }: { label: string }) {
  return (
    <span
      data-speaker-tag
      className="mr-2 inline-block rounded-[0.2rem] px-[0.45em] py-[0.05em] align-middle font-['Barlow_Condensed',sans-serif] text-[0.68rem] font-semibold tracking-[0.06em] uppercase"
      style={{ background: 'color-mix(in srgb, var(--character) 22%, transparent)', color: 'var(--character-text)' }}
    >
      {label}
    </span>
  );
}

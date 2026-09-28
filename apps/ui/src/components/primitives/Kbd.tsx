// A key cap for a hotkey hint (a toolbar label, a shortcut sheet). No platform logic lives here: the input registry (ADR
// 0361) resolves Mod to Meta or Ctrl and hands this component the caps to draw. A chord has no single spoken word, so, like
// `MeterBar` (ADR 0050), it is one image named by its own text - `label` overrides that name for a symbol key (⌫) whose
// glyph alone would read as a stray character instead of "Backspace".
export type KbdSize = 'md' | 'sm';

// The booth's command bar draws a 23 px cap (mock 03); everywhere else - the companion, Settings, the shortcut sheet -
// draws the 18 px cap the benchmark mocks measure for a dense row (mock-fidelity-primitives-and-components.prd.md Phase 10).
const SIZE_CLASSES: Record<KbdSize, string> = {
  md: 'h-[1.4375rem] px-[0.4rem]',
  sm: 'h-[1.125rem] px-[0.35rem]',
};

export function Kbd({ keys, label, size = 'sm' }: { keys: string[]; label?: string; size?: KbdSize }) {
  const name = label ?? keys.join(' + ');
  return (
    <span role="img" aria-label={name} className="inline-flex items-center gap-1 font-['IBM_Plex_Mono',ui-monospace,monospace] text-[0.75rem] leading-none">
      {keys.map((key, index) => (
        <span key={index} className="inline-flex items-center gap-1">
          {index > 0 && <span className="text-[var(--text-muted)]">+</span>}
          {/* The bottom edge is 2 px, a shade deeper than the 1 px top/left/right border, so the cap reads as a pressed key (B03, B07). */}
          <kbd
            className={`box-border inline-flex items-center justify-center rounded-[0.25rem] border border-b-2 border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)] ${SIZE_CLASSES[size]}`}
          >
            {key}
          </kbd>
        </span>
      ))}
    </span>
  );
}

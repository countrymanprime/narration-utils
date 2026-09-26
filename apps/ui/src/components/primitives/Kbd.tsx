// A key cap for a hotkey hint (a toolbar label, a shortcut sheet). No platform logic lives here: the input registry (ADR
// 0361) resolves Mod to Meta or Ctrl and hands this component the caps to draw. A chord has no single spoken word, so, like
// `MeterBar` (ADR 0050), it is one image named by its own text - `label` overrides that name for a symbol key (⌫) whose
// glyph alone would read as a stray character instead of "Backspace".
export function Kbd({ keys, label }: { keys: string[]; label?: string }) {
  const name = label ?? keys.join(' + ');
  return (
    <span role="img" aria-label={name} className="inline-flex items-center gap-1 font-mono text-[0.75rem] leading-none">
      {keys.map((key, index) => (
        <span key={index} className="inline-flex items-center gap-1">
          {index > 0 && <span className="text-[var(--text-muted)]">+</span>}
          <kbd className="rounded-[0.25rem] border border-[var(--border)] bg-[var(--surface-2)] px-[0.35rem] py-[0.1rem] text-[var(--text)]">{key}</kbd>
        </span>
      ))}
    </span>
  );
}

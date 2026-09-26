/**
 * A gesture is what any input device turns into once normalised (ADR 0361 decision 3): the same shape whether it
 * came from a key, a MIDI note/CC or an HID button. `code` is `KeyboardEvent.code` for a keyboard gesture (PRD Q1):
 * the physical key, stable across keyboard layouts, never the character it types (`event.key` would move on a
 * German keyboard).
 */
export type GestureSource = 'keyboard' | 'midi' | 'hid';

/** A held modifier on a resolved, comparable gesture. */
export type ModifierKey = 'Alt' | 'Ctrl' | 'Meta' | 'Shift';

/** A modifier as written in a catalog default: `Mod` is a placeholder ADR 0361 resolves to `Meta` on macOS and
 * `Ctrl` elsewhere, so one default reads right on every platform. `resolveGesture` turns it into a `Gesture`. */
export type DefaultModifierKey = ModifierKey | 'Mod';

export type Gesture = {
  source: GestureSource;
  code: string;
  modifiers: ModifierKey[];
};

/** A catalog default, written with `Mod` where the platform default should follow it. */
export type DefaultGesture = {
  source: GestureSource;
  code: string;
  modifiers: DefaultModifierKey[];
};

const MODIFIER_ORDER: readonly ModifierKey[] = ['Alt', 'Ctrl', 'Meta', 'Shift'];

function sortModifiers(modifiers: readonly ModifierKey[]): ModifierKey[] {
  return [...new Set(modifiers)].sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b));
}

/** Builds a resolved gesture with its modifiers in one stable order, so two gestures built from the same set in a
 * different order still compare and serialise equal. */
export function gesture(source: GestureSource, code: string, modifiers: readonly ModifierKey[] = []): Gesture {
  return { source, code, modifiers: sortModifiers(modifiers) };
}

/** `Mod` -> `Meta` on macOS, `Ctrl` elsewhere (Solution Detail). `isMac` is a parameter, not a `navigator` read, so
 * this stays pure and testable; `keymap.ts` supplies the real platform at call time. */
export function resolveGesture(def: DefaultGesture, isMac: boolean): Gesture {
  const modifiers = def.modifiers.map((modifier) => (modifier === 'Mod' ? (isMac ? 'Meta' : 'Ctrl') : modifier)) as ModifierKey[];
  return gesture(def.source, def.code, modifiers);
}

/**
 * The stable string a gesture serialises to (Solution Detail): `Alt+ArrowLeft`, `midi:cc/1/64`,
 * `hid:<vid>:<pid>/<button>`. Two gestures bind the same physical input iff their serialisation is equal - this is
 * the lookup and conflict key everywhere else in `src/input/` compares gestures.
 */
export function serializeGesture(g: Gesture): string {
  if (g.source !== 'keyboard') return `${g.source}:${g.code}`;
  return [...sortModifiers(g.modifiers), g.code].join('+');
}

type KeyboardModifierState = { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean };

/** Turns a live `KeyboardEvent` (or a fake with the same four flags) into a resolved keyboard `Gesture`. */
export function gestureFromKeyboardEvent(event: KeyboardModifierState & { code: string }): Gesture {
  const modifiers: ModifierKey[] = [];
  if (event.altKey) modifiers.push('Alt');
  if (event.ctrlKey) modifiers.push('Ctrl');
  if (event.metaKey) modifiers.push('Meta');
  if (event.shiftKey) modifiers.push('Shift');
  return gesture('keyboard', event.code, modifiers);
}

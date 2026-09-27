import { Button } from '../primitives/Button';
import { Dialog } from '../primitives/Dialog';
import { Kbd } from '../primitives/Kbd';
import { COMMAND_CATALOG, type CommandDescriptor } from '../../input/commands.catalog';
import { serializeGesture, type Gesture } from '../../input/gestures';
import { defaultKeymap } from '../../input/keymap';
import { CommandScope } from '../../input/router';
import type { Scope } from '../../input/scopes';

// Every command is listed here, not only the ones active on the screen that opened the sheet (Success Metrics: "every
// catalog command is discoverable... 100% listed in Settings and in the '?' sheet"), grouped the same way the Phase 6
// Keyboard & pedals category groups them (PRD user flow step 1). This order is display-only, unrelated to
// `SCOPE_PRIORITY` (router.tsx), which orders scopes by specificity for gesture lookup, not for reading.
const SCOPE_ORDER: readonly Scope[] = ['global', 'page', 'booth', 'dialog'];
const SCOPE_LABEL: Record<Scope, string> = { global: 'Global', page: 'Page', booth: 'Booth', dialog: 'Dialog' };

// A resolved keyboard gesture's `code` is the physical key (PRD Q1), not the character it types, so it reads "Slash"
// rather than "?"; this is the one place in the app that turns a code back into a cap a narrator recognises.
const NAMED_CODES: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  BracketLeft: '[',
  BracketRight: ']',
  Slash: '/',
  Space: 'Space',
  BrowserBack: 'Browser Back',
  BrowserForward: 'Browser Forward',
};

// @public: exported only for direct unit tests (ShortcutSheet.test.tsx); not used outside this file otherwise.
export function codeLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return NAMED_CODES[code] ?? code;
}

// The Kbd caps for one gesture, modifiers first. A MIDI or HID gesture (Phases 9, 11) has no key caps to draw yet, so
// it falls back to its serialised form rather than pretending to be a keyboard chord. @public: see `codeLabel`.
export function gestureKeys(gesture: Gesture): string[] {
  if (gesture.source !== 'keyboard') return [serializeGesture(gesture)];
  return [...gesture.modifiers, codeLabel(gesture.code)];
}

function groupByScope(catalog: readonly CommandDescriptor[]): Partial<Record<Scope, CommandDescriptor[]>> {
  const groups: Partial<Record<Scope, CommandDescriptor[]>> = {};
  for (const command of catalog) (groups[command.scope] ??= []).push(command);
  return groups;
}

// The "?" (Shift+Slash) shortcut sheet (input-commands-and-pedals.prd.md Phase 7): every command in the catalog,
// grouped by scope, each with its bound gestures as Kbd chips. Its content claims the router's `dialog` scope
// (ADR 0361 decision 4), the first feature to do so - while it is open, a `global` command like Back/Forward no
// longer matches (`activeScopes`, router.tsx), the same way any other open dialog already stops them through
// `App.tsx`'s own `isModalOpen` check.
export function ShortcutSheet({ onClose, onShowAll }: { onClose: () => void; onShowAll: () => void }) {
  const keymap = defaultKeymap();
  const groups = groupByScope(COMMAND_CATALOG);

  return (
    <CommandScope kind="dialog">
      <Dialog title="Keyboard shortcuts" onClose={onClose} actionsAlign="end" actions={<Button onClick={onShowAll}>Show all shortcuts</Button>}>
        <div className="flex flex-col gap-4">
          {SCOPE_ORDER.filter((scope) => groups[scope]?.length).map((scope) => (
            <section key={scope}>
              <h3 className="mb-2 text-[0.75rem] font-semibold tracking-[0.04em] text-[var(--text-muted)] uppercase">{SCOPE_LABEL[scope]}</h3>
              <ul className="flex flex-col gap-2">
                {groups[scope]!.map((command) => (
                  <li key={command.id} className="flex items-center justify-between gap-4">
                    <span>{command.label}</span>
                    <span className="flex items-center gap-2">
                      {(keymap[command.id] ?? []).map((gesture, index) => (
                        <Kbd key={index} keys={gestureKeys(gesture)} />
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Dialog>
    </CommandScope>
  );
}

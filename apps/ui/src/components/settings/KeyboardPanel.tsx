import { useCallback, useMemo, useState } from 'react';
import { describeApiError } from '../../api/errorMessage';
import { useApi } from '../../api/ApiContext';
import { EMPTY_KEYMAP_OVERRIDES, keymapOverridesSchema } from '../../api/schemas/keymap';
import { parseWireJson } from '../../api/wire/parseWire';
import type { ScopedSettingField } from '../../types';
import { Button } from '../primitives/Button';
import { Kbd } from '../primitives/Kbd';
import { StatusBadge } from '../primitives/StatusBadge';
import type { Notify } from '../primitives/Toast';
import { COMMAND_CATALOG, type CommandDescriptor, type CommandId } from '../../input/commands.catalog';
import { findConflicts, type Conflict } from '../../input/findConflicts';
import { serializeGesture, type Gesture } from '../../input/gestures';
import { bindingsFromKeymap, defaultKeymap, keymapFromBindings, type Keymap } from '../../input/keymap';
import { type Scope } from '../../input/scopes';
import { useGestureCapture } from '../../input/useGestureCapture';

// Grouping and copy mirror the "?" sheet (ShortcutSheet.tsx), which lists the same catalog by the same scopes; the
// PRD's Visual Spec section fixes this display order (Global, Page, Booth) and the "applies where" subtitle text.
const SCOPE_ORDER: readonly Scope[] = ['global', 'page', 'booth', 'dialog'];
const SCOPE_LABEL: Record<Scope, string> = { global: 'Global', page: 'Page', booth: 'Booth', dialog: 'Dialog' };
const SCOPE_APPLIES: Record<Scope, string> = {
  global: 'anywhere, except while a dialog is open',
  page: "a chapter's Proof view",
  booth: 'the Booth and its companion panel',
  dialog: 'while a dialog is open',
};
// The same phrase used mid-sentence ("No other command uses it ..."), Visual Spec mockup 02.
const SCOPE_ACTIVE: Record<Scope, string> = {
  global: 'anywhere',
  page: "on a chapter's Proof view",
  booth: 'where reading happens',
  dialog: 'in this dialog',
};

function groupByScope(catalog: readonly CommandDescriptor[]): Partial<Record<Scope, CommandDescriptor[]>> {
  const groups: Partial<Record<Scope, CommandDescriptor[]>> = {};
  for (const command of catalog) (groups[command.scope] ??= []).push(command);
  return groups;
}

// A resolved keyboard gesture's `code` is the physical key (PRD Q1), not the character it types, so this reads
// "Slash" rather than "?" - the same reasoning and the same table as ShortcutSheet.tsx's own `codeLabel`, kept as a
// separate copy here since that one is exported only for its own unit tests (see its `@public` comment).
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
  PageUp: 'Page Up',
  PageDown: 'Page Down',
};

function codeLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return NAMED_CODES[code] ?? code;
}

/** The `Kbd` caps for one gesture, modifiers first; a MIDI or HID gesture (Phases 9, 11) falls back to its serialised
 * form, matching ShortcutSheet.tsx's own `gestureKeys`. */
function gestureKeys(gesture: Gesture): string[] {
  if (gesture.source !== 'keyboard') return [serializeGesture(gesture)];
  return [...gesture.modifiers, codeLabel(gesture.code)];
}

function gestureLabel(gesture: Gesture): string {
  return gestureKeys(gesture).join(' + ');
}

/** The command another command's own gesture list would collide with, if `gesture` were added to `commandId`
 * (Solution Detail: "Conflict messages come from findConflicts"). Built as a hypothetical keymap rather than a
 * bespoke lookup, so a remap is checked by the same pure function the catalog's own zero-conflicts test uses. */
function conflictFor(catalog: readonly CommandDescriptor[], keymap: Keymap, commandId: CommandId, gesture: Gesture): Conflict | undefined {
  const candidate: Keymap = { ...keymap, [commandId]: [...(keymap[commandId] ?? []), gesture] };
  return findConflicts(catalog, candidate).find((conflict) => conflict.commands.includes(commandId));
}

function otherCommandId(conflict: Conflict, commandId: CommandId): CommandId {
  return conflict.commands[0] === commandId ? conflict.commands[1] : conflict.commands[0];
}

function isChanged(keymap: Keymap, defaults: Keymap, commandId: CommandId): boolean {
  const current = (keymap[commandId] ?? []).map(serializeGesture).sort();
  const base = (defaults[commandId] ?? []).map(serializeGesture).sort();
  return current.length !== base.length || current.some((value, index) => value !== base[index]);
}

// The "Keys and pedals" intro copy matches the owner-approved mockups
// (docs/prds/mockups/input-commands-and-pedals/01-settings-global-keyboard.webp); the "Changed" badge is THE pill's warn
// outline (StatusBadge, ADR 0600), the dark sets' "CHANGED".

function GestureChips({ gestures }: { gestures: Gesture[] }) {
  if (gestures.length === 0) {
    return (
      <span className="text-[0.8rem]" style={{ color: 'var(--text-muted)' }}>
        Unbound
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      {gestures.map((gesture, index) => (
        <Kbd key={index} keys={gestureKeys(gesture)} />
      ))}
    </span>
  );
}
type RecorderProps = {
  command: CommandDescriptor;
  currentGestures: Gesture[];
  scope: Scope;
  catalog: readonly CommandDescriptor[];
  keymap: Keymap;
  busy: boolean;
  onCancel: () => void;
  onReplace: (gesture: Gesture, stolenFrom?: CommandId) => void;
  onAdd: (gesture: Gesture) => void;
  onUnbind: () => void;
  onResetOne: () => void;
};

// The recorder opens inline under its row, not in a dialog (Visual Spec): capturing, then a captured or a conflict
// state (mockups 02 and 03). Its status line is a live region (Phase 6 scope: "a live region that announces the
// captured gesture"), so a screen reader hears the result of a press without moving focus.
function Recorder({ command, currentGestures, scope, catalog, keymap, busy, onCancel, onReplace, onAdd, onUnbind, onResetOne }: RecorderProps) {
  const [captured, setCaptured] = useState<Gesture>();
  useGestureCapture(!busy, setCaptured, onCancel);

  const conflict = captured ? conflictFor(catalog, keymap, command.id, captured) : undefined;
  const conflictCommand = conflict ? catalog.find((entry) => entry.id === otherCommandId(conflict, command.id)) : undefined;

  const status = !captured
    ? `Press a key or a pedal for "${command.label}"…`
    : conflict && conflictCommand
      ? `${gestureLabel(captured)} already runs "${conflictCommand.label}".`
      : `${gestureLabel(captured)} captured. No other command uses it ${SCOPE_ACTIVE[scope]}.`;

  return (
    <div
      role="group"
      aria-label={`Change "${command.label}"`}
      className="mt-3 rounded-md border p-3"
      style={{ borderColor: 'var(--accent)', background: 'var(--surface-2)' }}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium">
        <span>Change "{command.label}"</span>
        <span style={{ color: 'var(--text-muted)' }}>now</span>
        <GestureChips gestures={currentGestures} />
      </div>
      <div className="rounded-md border border-dashed p-4 text-center" style={{ borderColor: 'var(--border)' }}>
        <div className="text-[0.7rem] font-semibold tracking-[0.08em] uppercase" style={{ color: 'var(--text-muted)' }}>
          Captured
        </div>
        <div className="my-2 flex justify-center">{captured ? <Kbd keys={gestureKeys(captured)} /> : <span aria-hidden="true">—</span>}</div>
        <p className="text-[0.75rem]" style={{ color: 'var(--text-muted)' }}>
          Press another key or pedal to try again. Esc cancels.
        </p>
      </div>
      <p role="status" aria-live="polite" className="mt-2 text-sm">
        {status}
      </p>
      {conflict && conflictCommand && (
        <p role="alert" className="mt-1 rounded-md border p-2 text-[0.82rem]" style={{ borderColor: 'var(--warn)', color: 'var(--warn-text)' }}>
          Replace takes it from "{conflictCommand.label}", which is then left with no key; you can give it another one afterwards.
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button disabled={!captured || busy} onClick={() => captured && onReplace(captured, conflict ? conflictCommand?.id : undefined)}>
          Replace
        </Button>
        {!conflict && (
          <>
            <Button variant="secondary" disabled={!captured || busy} onClick={() => captured && onAdd(captured)}>
              Add as another key
            </Button>
            <Button variant="secondary" disabled={busy} onClick={onUnbind}>
              Unbind
            </Button>
            <Button variant="secondary" disabled={busy} onClick={onResetOne}>
              Reset to default
            </Button>
          </>
        )}
        {conflict && (
          <Button variant="secondary" disabled={busy} onClick={() => setCaptured(undefined)}>
            Try another key
          </Button>
        )}
        <Button variant="secondary" className="ml-auto" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * Settings > Keyboard & pedals (input-commands-and-pedals.prd.md Phase 6): every command in the catalog, grouped by
 * scope, remappable by pressing a key or a pedal. Self-contained like DeliveryProfilesPanel/CreditsPanel: it reads and
 * writes the `Keymap.overrides` row (Phase 5) directly rather than through Settings.tsx's generic dirty-tracking form,
 * since that mechanism is for a page of independent fields with a shared Save button, and this is one JSON document a
 * narrator changes one command at a time (each action saves immediately, like LocalAssets' install actions).
 */
export function KeyboardPanel({
  overridesField,
  notify,
  reload,
}: {
  overridesField: ScopedSettingField | undefined;
  notify: Notify;
  reload: () => Promise<void>;
}) {
  const api = useApi();
  const [recordingId, setRecordingId] = useState<CommandId>();
  const [busy, setBusy] = useState(false);

  const overrides = useMemo(() => {
    try {
      return parseWireJson(keymapOverridesSchema, overridesField?.effectiveValue ?? '', { boundary: 'settings', payload: 'Keymap.overrides' });
    } catch {
      // A malformed document falls back to the defaults (Phase 5's own rule) rather than failing the whole panel to load.
      return EMPTY_KEYMAP_OVERRIDES;
    }
  }, [overridesField?.effectiveValue]);
  const keymap = useMemo(() => keymapFromBindings(overrides.bindings), [overrides]);
  const defaults = useMemo(() => defaultKeymap(), []);
  const groups = useMemo(() => groupByScope(COMMAND_CATALOG), []);
  const anyChanged = COMMAND_CATALOG.some((command) => isChanged(keymap, defaults, command.id));

  const persist = useCallback(
    async (nextKeymap: Keymap) => {
      setBusy(true);
      try {
        const bindings = bindingsFromKeymap(nextKeymap);
        await api.saveSettings('Keymap', 'global', { overrides: JSON.stringify({ version: 1 as const, bindings }) });
        setRecordingId(undefined);
        notify('Keyboard shortcut saved.');
        await reload();
      } catch (error) {
        notify(describeApiError(error), 'error');
      } finally {
        setBusy(false);
      }
    },
    [api, notify, reload],
  );

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-medium">Keys and pedals</div>
          <p style={{ color: 'var(--text-muted)' }}>
            Every command you can run without the mouse. Choose Change, then press the key or pedal to use. A USB footswitch that types a key works like a
            keyboard. These apply to every project.
          </p>
        </div>
        <Button variant="secondary" disabled={busy || !anyChanged} onClick={() => void persist(defaults)}>
          Reset all to defaults
        </Button>
      </div>
      {(keymap['help.shortcuts'] ?? [])[0] && (
        <p style={{ color: 'var(--text-muted)' }}>
          Press <Kbd keys={gestureKeys(keymap['help.shortcuts'][0])} /> anywhere to see what works on the screen you are on.
        </p>
      )}
      {SCOPE_ORDER.filter((scope) => groups[scope]?.length).map((scope) => (
        <section key={scope}>
          <h3 className="mb-1 text-[0.75rem] font-semibold tracking-[0.04em] uppercase" style={{ color: 'var(--text-muted)' }}>
            {SCOPE_LABEL[scope]} · {SCOPE_APPLIES[scope]}
          </h3>
          <div>
            {groups[scope]!.map((command) => {
              const gestures = keymap[command.id] ?? [];
              const changed = isChanged(keymap, defaults, command.id);
              return (
                <div key={command.id} className="border-b py-3" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {command.label}
                      {command.noisy && (
                        <span className="text-[0.75rem] font-normal" style={{ color: 'var(--text-muted)' }}>
                          Plays audio
                        </span>
                      )}
                      {changed && <StatusBadge tone="warning" look="outline" label="Changed" />}
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <GestureChips gestures={gestures} />
                      {changed && (
                        <Button variant="secondary" disabled={busy} onClick={() => void persist({ ...keymap, [command.id]: defaults[command.id] ?? [] })}>
                          Reset
                        </Button>
                      )}
                      <Button variant="secondary" disabled={busy} onClick={() => setRecordingId(recordingId === command.id ? undefined : command.id)}>
                        Change
                      </Button>
                    </span>
                  </div>
                  {recordingId === command.id && (
                    <Recorder
                      command={command}
                      currentGestures={gestures}
                      scope={scope}
                      catalog={COMMAND_CATALOG}
                      keymap={keymap}
                      busy={busy}
                      onCancel={() => setRecordingId(undefined)}
                      onReplace={(gesture, stolenFrom) => {
                        const next: Keymap = { ...keymap, [command.id]: [gesture] };
                        if (stolenFrom) next[stolenFrom] = (keymap[stolenFrom] ?? []).filter((bound) => serializeGesture(bound) !== serializeGesture(gesture));
                        void persist(next);
                      }}
                      onAdd={(gesture) => void persist({ ...keymap, [command.id]: [...gestures, gesture] })}
                      onUnbind={() => void persist({ ...keymap, [command.id]: [] })}
                      onResetOne={() => void persist({ ...keymap, [command.id]: defaults[command.id] ?? [] })}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { providedCommands } from '../../input/commandProviders';
import { COMMAND_CATALOG, type CommandDescriptor, type CommandId } from '../../input/commands.catalog';
import type { Gesture } from '../../input/gestures';
import type { Keymap } from '../../input/keymap';
import { commandsFor } from '../../input/surfaces';
import { overlay, type OverlayService } from '../../overlay/overlayService';
import { searchAll } from '../../registries/search';
import { KeyChord } from '../primitives/KeyCap';
import { Listbox, listboxOptionId, type ListboxOption } from '../primitives/Listbox';
import { TextField } from '../primitives/TextField';

// One row of the list, whatever it came from: a group, the way back out of one, a catalogue command, a provided command or a search hit.
type Entry = {
  id: string;
  group: string;
  title: string;
  /** Matched against the typed term and shown in the muted line. */
  hint?: string;
  sub?: string;
  keys?: string[];
  /** A group row or the back row: choosing it changes the list and leaves the menu open. */
  keepOpen?: boolean;
  /** Why the command cannot run now: it stays listed, off, with this reason. */
  disabledReason?: string;
  run: () => void;
};

// A resolved gesture's `code` is the physical key, so this reads "Slash" where the key cap should say "/".
const NAMED_CODES: Record<string, string> = { Equal: '=', Minus: '-', BracketLeft: '[', BracketRight: ']', Slash: '/', Comma: ',', Period: '.' };
function gestureKeys(gesture: Gesture | undefined): string[] | undefined {
  if (!gesture) return undefined;
  if (gesture.source !== 'keyboard') return [gesture.code];
  const code = gesture.code.replace(/^(Key|Digit)/, '');
  return [...gesture.modifiers, NAMED_CODES[code] ?? code];
}

const matches = (entry: Entry, tokens: readonly string[]) => {
  const text = `${entry.title} ${entry.hint ?? ''}`.toLowerCase();
  return tokens.every((token) => text.includes(token));
};

type JumpMenuProps = {
  /** The narrator's gestures, so a catalogue row draws the key it is really bound to. */
  keymap: Keymap;
  /** Runs a catalogue command by id; the shell routes it to the handler a page registered with `useCommand`. */
  runCommand: (id: CommandId) => void;
  close: () => void;
  initialTerm?: string;
  catalog?: readonly CommandDescriptor[];
};

/**
 * The jump menu's content (docs/architecture/studio-shell-and-registries.md#command-providers-and-go-to): the catalogue rows for the `jumpMenu` surface, the commands providers return, then
 * search-source hits, filtered by the typed term. With nothing typed it shows one row per group and a group opens to its commands.
 * A leading `>` lists commands only. The field keeps focus and names the active option; nothing here waits on the host.
 */
function JumpMenu({ keymap, runCommand, close, initialTerm = '', catalog = COMMAND_CATALOG }: JumpMenuProps) {
  const listId = useId();
  const [query, setQuery] = useState(initialTerm);
  const [group, setGroup] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  // Providers are asked once per open, not per keystroke.
  const commands = useMemo<Entry[]>(
    () => [
      ...commandsFor('jumpMenu', catalog).map((row) => ({
        id: `static-${row.id}`,
        group: row.group ?? 'Commands',
        title: row.label,
        hint: row.hint,
        keys: gestureKeys(keymap[row.id]?.[0]),
        run: () => runCommand(row.id),
      })),
      ...providedCommands(catalog).map((row) => ({
        id: `provided-${row.id}`,
        group: row.group,
        title: row.label,
        hint: row.hint,
        disabledReason: row.disabledReason,
        run: row.run,
      })),
    ],
    [catalog, keymap, runCommand],
  );

  const raw = query.trim();
  const commandsOnly = raw.startsWith('>');
  const term = (commandsOnly ? raw.slice(1) : raw).trim().toLowerCase();

  const { entries } = useMemo(() => {
    if (!term && !commandsOnly) {
      if (group) {
        const back: Entry = { id: 'back', group, title: '‹ All commands', keepOpen: true, run: () => {} };
        return { entries: [back, ...commands.filter((entry) => entry.group === group)] };
      }
      const groups = [...new Set(commands.map((entry) => entry.group))];
      const rows = groups.map<Entry>((name) => ({
        id: `group-${name}`,
        group: 'Commands',
        title: name,
        sub: `${commands.filter((entry) => entry.group === name).length} ›`,
        keepOpen: true,
        run: () => {},
      }));
      return { entries: rows };
    }
    const tokens = term.split(/\s+/).filter(Boolean);
    const hits = commandsOnly
      ? []
      : searchAll(term).map<Entry>((hit, index) => ({ id: `hit-${index}`, group: hit.group, title: hit.title, sub: hit.sub, run: hit.run }));
    return { entries: [...hits, ...commands.filter((entry) => matches(entry, tokens))] };
  }, [commands, commandsOnly, group, term]);

  const activeIndex = Math.min(active, Math.max(0, entries.length - 1));
  const activeEntry = entries[activeIndex];
  const activeOptionId = activeEntry ? listboxOptionId(listId, activeEntry.id) : undefined;
  useEffect(() => {
    if (activeOptionId) document.getElementById(activeOptionId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeOptionId]);

  const choose = (entry: Entry | undefined) => {
    // An off command stays listed with its reason; running it does nothing and the menu stays open.
    if (!entry || entry.disabledReason) return;
    if (entry.id === 'back') {
      setGroup(null);
      setActive(0);
    } else if (entry.keepOpen) {
      setGroup(entry.title);
      setActive(0);
    } else {
      close();
      entry.run();
    }
  };

  const options = entries.map<ListboxOption>((entry) => {
    const trailing: ReactNode = entry.keys ? <KeyChord keys={entry.keys} /> : entry.sub;
    return {
      id: entry.id,
      label: entry.title,
      description: entry.disabledReason ?? entry.hint,
      trailing,
      group: entry.group,
      disabled: Boolean(entry.disabledReason),
    };
  });

  return (
    <>
      <div className="border-b border-[var(--line)] p-2">
        <TextField
          label="Jump menu"
          autoFocus
          autoComplete="off"
          role="combobox"
          aria-expanded
          aria-autocomplete="list"
          aria-controls={listId}
          aria-activedescendant={activeOptionId}
          placeholder="Search, or jump to a page or chapter. Type > for commands."
          value={query}
          onChange={(value) => {
            setQuery(value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive(Math.min(entries.length - 1, activeIndex + 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive(Math.max(0, activeIndex - 1));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              choose(activeEntry);
            } else if (event.key === 'Backspace' && !query && group) {
              event.preventDefault();
              setGroup(null);
              setActive(0);
            }
          }}
        />
      </div>
      <Listbox
        id={listId}
        label="Jump menu results"
        options={options}
        activeIndex={activeIndex}
        onPick={(id) => choose(entries.find((entry) => entry.id === id))}
        empty="Nothing matches"
        flush
      />
    </>
  );
}

export type JumpMenuOptions = Omit<JumpMenuProps, 'close'> & { service?: OverlayService };

/** Opens the jump menu in a dialog and returns the function that closes it. The first list is drawn in the same call. */
export function openJumpMenu({ service = overlay, ...props }: JumpMenuOptions): () => void {
  return service.open({
    kind: 'dialog',
    title: 'Jump menu',
    headerless: true,
    dismissOnOutsidePress: true,
    render: ({ close }) => <JumpMenu {...props} close={close} />,
  });
}

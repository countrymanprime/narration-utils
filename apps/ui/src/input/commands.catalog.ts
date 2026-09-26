import type { DefaultGesture, GestureSource } from './gestures';
import type { Scope } from './scopes';

export type CommandId = string;

/**
 * One command a narrator can run, as static data (Solution Detail, ADR 0361 decision 1): an id, its scope, whether
 * it is `noisy` (suppressed while the DAW reports recording, Phase 10) and its default gestures. A feature attaches
 * behaviour at runtime with `useCommand(id, handler, enabled)` and never listens for a key itself.
 */
export type CommandDescriptor = {
  id: CommandId;
  label: string;
  scope: Scope;
  /** Plays or previews audio, so it is silenced while the DAW records (Phase 10, PRD Q5). Absent means not noisy. */
  noisy?: true;
  defaults: DefaultGesture[];
};

function key(code: string, modifiers: DefaultGesture['modifiers'] = [], source: GestureSource = 'keyboard'): DefaultGesture {
  return { source, code, modifiers };
}

/**
 * Today's exact shortcuts (Phase 1 scope), gathered from the three listeners this PRD replaces - `App.tsx:269-306`,
 * `WorkspacePage.tsx:148-185` and `ReadingControlBar.tsx:70-95` (`useSpaceShortcut`, ADR 0196) - with no behaviour
 * change yet: nothing here is wired to a component until Phases 2 to 4 migrate its listener. `code` is `Mod` where
 * today's shortcut is Cmd on macOS (`resolveGesture` turns it into `Meta` or `Ctrl`); F13-F24 stay unbound by
 * default (Solution Detail) so a programmable pedal can use them with no conflict.
 *
 * `commandCatalog.test.ts` fails on a duplicate id and on the default keymap it builds (`keymap.ts`) having any
 * conflict (`findConflicts.ts`). A row is never deleted for going unregistered in Phase 1: nothing is registered yet.
 */
export const COMMAND_CATALOG: readonly CommandDescriptor[] = [
  { id: 'nav.back', label: 'Back', scope: 'global', defaults: [key('ArrowLeft', ['Alt']), key('BrowserBack'), key('BracketLeft', ['Mod'])] },
  { id: 'nav.forward', label: 'Forward', scope: 'global', defaults: [key('ArrowRight', ['Alt']), key('BrowserForward'), key('BracketRight', ['Mod'])] },
  { id: 'workspace.play', label: 'Play or pause the chapter', scope: 'page', noisy: true, defaults: [key('Space')] },
  { id: 'workspace.word.prev', label: 'Previous word', scope: 'page', defaults: [key('ArrowLeft')] },
  { id: 'workspace.word.next', label: 'Next word', scope: 'page', defaults: [key('ArrowRight')] },
  { id: 'workspace.paragraph.prev', label: 'Previous paragraph', scope: 'page', defaults: [key('ArrowUp')] },
  { id: 'workspace.paragraph.next', label: 'Next paragraph', scope: 'page', defaults: [key('ArrowDown')] },
  { id: 'workspace.flag.prev', label: 'Previous flag', scope: 'page', defaults: [key('BracketLeft')] },
  { id: 'workspace.flag.next', label: 'Next flag', scope: 'page', defaults: [key('BracketRight')] },
  // Not noisy: it starts or pauses the live listening/transcription session (`useTeleprompterSession`), which plays
  // no audio of its own - unlike `workspace.play`, a recorded-audio player (PRD Q5).
  { id: 'reading.toggle', label: 'Play or pause reading', scope: 'booth', defaults: [key('Space')] },
];

export function findCommand(id: CommandId): CommandDescriptor | undefined {
  return COMMAND_CATALOG.find((command) => command.id === id);
}

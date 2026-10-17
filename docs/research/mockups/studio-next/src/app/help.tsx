import { IconButton } from '@/ui/primitives'
import { KeyChord } from '@/ui/KeyCap'
import { openModal } from '@/ui/overlay'
import { modals } from './modals'

/**
 * A shortcut is a list of ways to do it. A way is the keys pressed (named as `KeyCap` knows them: "↑", "Esc", "Right-click", "Space"),
 * or a plain string for something that is not a key ("Jump menu", "Wheel").
 */
type Way = string[] | string
type Spec = Array<[label: string, ways: Way[]]>

const CTRL_K: Way = ['Ctrl', 'K']

/** The shortcut list (Settings). */
const SHORTCUT_SPEC: Spec = [
  ['Jump menu and search', [CTRL_K]],
  ['Find in the manuscript', [['Ctrl', 'F']]],
  ['Context menu', [['Right-click'], ['Shift', 'F10']]],
  ['Scroll the script', [['↑', '↓'], ['Space']]],
  ['Prep state of a chapter', [['←', '→']]],
  ['Bookmark here (Script, Booth)', [['B']]],
  ['Previous / next bookmark (Script, Booth)', [['[', ']']]],
  ['Next / previous proof note', [['↑', '↓']]],
  ['Proof decision', [['P', 'E', 'W', 'D']]],
  ['Proof: previous / next chapter', [['←', '→']]],
  ['Editing: previous / next word', [['←', '→']]],
  ['Editing: previous / next phrase', [['Ctrl', '←', '→'], ['↑', '↓']]],
  ['Editing: select words', [['Shift', '←', '→'], ['Right-click']]],
  ['Editing: play from the cursor or the selection / pause', [['Space']]],
  ['Editing: delete the selected words and audio', [['Del']]],
  ['Editing: mute the selected words', [['M']]],
  ['Editing: add FX to the selected words', [['F']]],
  ['Editing: previous / next take of the line', [['T'], ['Shift', 'T']]],
  ['Editing: keep the take', [['Enter']]],
  ['Editing: hide / show the other takes', [['H']]],
  ['Editing: previous / next flagged word', [['['], [']']]],
  ['Editing: timeline strip', [['S']]],
  ['Editing: clean up and effects drawer', [['Ctrl', 'Shift', 'C']]],
  ['Editing: previous / next chapter', [['Alt', '↑', '↓']]],
  ['Open settings (Esc or Back returns)', [['Ctrl', ',']]],
  ['Undo last change', [['Ctrl', 'Z']]],
  ['Booth: record', [['Space']]],
  ['Booth: punch and roll', [['R']]],
  ['Booth: start from a phrase', [['Right-click']]],
  ['Booth: scroll the text', ['Wheel', ['Page Up', 'Page Down']]],
  ['Booth: full screen', [['F11']]],
  ['Booth: previous / next phrase', [['↑', '↓']]],
  ['Exit Booth', [['Esc']]],
]

/** The shortcut sheet (?). */
const HELP_SPEC: Spec = [
  ['Jump menu and search', [CTRL_K]],
  ['Context menu', [['Right-click'], ['Shift', 'F10']]],
  ['Find in the manuscript', [['Ctrl', 'F']]],
  ['Shortcut sheet', [['?']]],
  ['Bookmark here (Script, Booth)', [['B']]],
  ['Previous / next bookmark (Script, Booth)', [['[', ']']]],
  ['Proof: next / previous note', [['J', 'K'], ['↑', '↓']]],
  ['Proof: previous / next chapter', [['←', '→']]],
  ['Proof: pickup / edit / waive / defer', [['P', 'E', 'W', 'D']]],
  ['Proof: play around the note', [['Space']]],
  ['Editing: word / phrase', [['←', '→'], ['Ctrl', '←', '→']]],
  ['Editing: select words', [['Shift', '←', '→']]],
  ['Editing: play / pause', [['Space']]],
  ['Editing: delete words and audio', [['Del']]],
  ['Editing: add FX', [['F']]],
  ['Editing: take of the line', [['T'], ['Shift', 'T']]],
  ['Editing: keep the take', [['Enter']]],
  ['Editing: hide / show the other takes', [['H']]],
  ['Editing: flagged word', [['['], [']']]],
  ['Editing: timeline', [['S']]],
  ['Editing: clear', [['Esc']]],
  ['Editing: previous / next chapter', [['Alt', '↑', '↓']]],
  ['Undo last change', [['Ctrl', 'Z']]],
  ['Booth: record', [['Space']]],
  ['Booth: text size', [['+'], ['−']]],
  ['Booth: full screen', [['F11']]],
  ['Exit Booth', [['Esc']]],
  ['Zoom', ['Jump menu']],
]

/** A way as plain text, for lists that show one line of text (Settings). */
const wayText = (w: Way): string => (typeof w === 'string' ? w : w.join(' '))
const asText = (spec: Spec): Array<[string, string]> => spec.map(([l, ways]) => [l, ways.map(wayText).join(' · ')])

export const SHORTCUTS: Array<[string, string]> = asText(SHORTCUT_SPEC)

/** The sheet's keys for one shortcut: the keys as key caps (icons where a key has one), the ways told apart by "or". */
function Ways({ ways }: { ways: Way[] }) {
  return (
    <span className="ways">
      {ways.map((w, i) => (
        <span key={i} className="way">{i ? <span className="or"> or </span> : null}{typeof w === 'string' ? <span className="sub">{w}</span> : <KeyChord keys={w} />}</span>
      ))}
    </span>
  )
}

modals.help = () =>
  openModal({
    label: 'Keyboard shortcuts',
    render: ({ close }) => (
      <>
        <div className="dh"><h2 style={{ fontSize: 24 }}>Keyboard shortcuts</h2><span className="spacer" /><IconButton icon="x" tip="Close" onClick={close} /></div>
        <div className="sheetgrid">{HELP_SPEC.map(([a, ways]) => <div key={a}><span>{a}</span><Ways ways={ways} /></div>)}</div>
        <div className="df"><span className="sub">Shortcuts are ignored while you type. Proof keys work on Proof only.</span></div>
      </>
    ),
  })

# Character Voice Samples: Mark How You Voiced a Character in Editing, Replay It from the Story Bible and the Booth

**Source:** owner request of 2026-10-17; tracking issue [#1820](https://github.com/countrymanprime/narration-utils/issues/1820).

**Constraints:** [ADR 0012](../adr/0012-media-route-for-track-playback.md), [ADR 0018](../adr/0018-story-bible-entries-read-only-until-edit.md), [ADR 0026](../adr/0026-manuscript-line-identity-in-item-extension-data.md), [ADR 0048](../adr/0048-every-dialog-is-one-modal-shell-and-confirms-are-alert-dialogs.md), [ADR 0075](../adr/0075-every-action-that-leaves-the-interface-acknowledges-within-100-ms-cannot-be-fired-twice-and-tells-the-narrator-when-it-ends.md), [ADR 0388](../adr/0388-the-booth-is-a-page-keyed-by-its-address-and-only-exit-booth-stops-a-live-session.md), [ADR 0565](../adr/0565-the-series-voice-bible-pools-reference-clips-by-character-id-and-shows-no-books-until-a-second-book-has-data.md), [ADR 0760](../adr/0760-the-studio-next-mock-is-the-only-spec-for-every-page-it-covers-tokens-primitive-sizes-and-layouts-included.md), [ADR 0856](../adr/0856-the-editing-records-are-one-file-per-kind-keyed-by-word-with-its-text-checked-on-read-and-cleared-when-the-manuscript-is-replaced.md), [ADR 0860](../adr/0860-a-roll-keeps-the-earlier-audio-as-a-take-and-a-range-cut-a-chain-on-a-range-and-stacking-move-audio-and-never-delete-it.md). Proposed by this PRD: [ADR 0865](../adr/0865-a-voice-sample-is-a-clip-copied-into-the-project-folder-and-its-source-is-kept-as-provenance-only.md), [ADR 0866](../adr/0866-voice-samples-play-in-the-apps-own-audio-served-by-id-and-never-through-the-daw.md).

**Status (2026-10-17):** draft, design only. No code is written. Phase 0 (this pull request) holds the PRD, the two Proposed ADRs and a draft mock. The owner has decided open questions 1 to 9 (see the [Decisions Log](#decisions-log)), and has approved playing in the app's own audio ([ADR 0866](../adr/0866-voice-samples-play-in-the-apps-own-audio-served-by-id-and-never-through-the-daw.md)). Nothing in this PRD is waiting on the owner. The owner approved the draft mock on 2026-10-17, so phases 3 to 5 are no longer waiting on it.

## Problem Statement

A narrator voices a character in chapter 3 and has to sound the same in chapter 19. The only way to hear the earlier performance is to find the passage in the DAW and play it. The Story Bible has a **Reference clips** section whose Play button only says "Playing a reference clip in the app is a future integration" (`apps/ui/src/components/storybible/VoiceReferencesSection.tsx`), and the Booth shows each speaker's written voice note but no sound.

The narrator wants to mark, while editing, the stretches where a voice came out right, and replay them from the Story Bible and, while recording, from the Booth's speaker picker.

## Evidence

- **Owner request** (2026-10-17): mark a stretch in Editing as a sample for a character; play it from the Story Bible character entry and from the Booth, in the "in this chapter" list and when picking a character.
- **A play stub exists.** `VoiceReferencesSection.tsx` lists approved REAPER regions with a Play button that shows a toast; its comment says a play command "would be a new Lua bridge command". Its store is `characters/references.json` (`apps/desktop/internal/character/character.go`), which keeps a region GUID and a name and time snapshot, no audio.
- **The pieces for a better answer exist:**

| Need | What exists | Where |
| --- | --- | --- |
| Word times for a recorded chapter | Stored recording-check words, kept per source range with Whisper's score | [ADR 0128](../adr/0128-the-coverage-service-reads-the-saved-project-keeps-words-per-source-range-and-leaves-model-and-language-out-of-the-parameter-hash.md), `apps/desktop/internal/coverage/words.go`; Editing reads them through `WorkspaceAlignment` |
| Chapter time to source file and offset | `buildPlaylist`: each playable item with its source file, `sourceStart`, `sourceEnd` | `apps/ui/src/components/proof/playlist.ts` |
| Playing a source file in the app | One `Audio` over `GET /media?path=`, with Range support | [ADR 0012](../adr/0012-media-route-for-track-playback.md), `apps/desktop/media.go`, `useScriptPlayback.ts` |
| Cutting a window out of a WAV | `windowOf` and `wavHeader` read a window of PCM and write a header | `apps/desktop/internal/zerocross/wav.go` |
| Cutting at a quiet point | `zerocross.Snap` | `apps/desktop/internal/zerocross/zerocross.go` |
| Adding an action to the selection | `registerSelectionAction`, `registerWordMenuSection`, catalogue key rows | `apps/ui/src/components/editing/bar/selectionActions.ts`, `menu/wordMenuRegistry.ts`, `input/commands.catalog.ts` |
| A character picker in the Booth | `SpeakerChip`: a popover with a search field and a listbox of names | `apps/ui/src/components/booth/reading/SpeakerChip.tsx` |
| Characters near the current phrase | **Voices in this scene** side section | `apps/ui/src/components/booth/side/VoicesNearby.tsx` |
| "Not while recording" precedent | The Booth disables controls while `control.recording` | `apps/ui/src/components/booth/page/BoothNextPage.tsx` |
| A DAW way to play part of a file | `file_preview`: REAPER only, needs SWS, Experimental, refuses while recording | [capabilities](../reference/daw/capabilities.md#file_preview) |

- **What does not exist.** The real Booth picker lists every speaker flat; the Studio Next mock groups it with an **In this chapter** heading (`docs/research/mockups/studio-next/src/ui/SpeakerPicker.tsx`, `speakersInChapter`). Editing marks no stretch of audio for any purpose beyond cuts, effects and accepted words ([ADR 0856](../adr/0856-the-editing-records-are-one-file-per-kind-keyed-by-word-with-its-text-checked-on-read-and-cleared-when-the-manuscript-is-replaced.md)).

## Proposed Solution

1. **Mark in Editing.** The narrator selects words, presses **V** (or **Voice sample** on the selection toolbar, or the word menu), picks the character, optionally names the sample ("angry, to the Duke") and adds a note, hears the range, and saves. The same selection works for **Narration**.
2. **Where a sample is kept is a setting.** The default copies the marked stretch (with a short handle each side, cut at the nearest zero crossing) into `<project>/narration-utils/voice-samples/`, and the record keeps where it came from as provenance only; this works with every DAW and with none, and playing it never touches the DAW or the narrator's place in the project ([ADR 0865](../adr/0865-a-voice-sample-is-a-clip-copied-into-the-project-folder-and-its-source-is-kept-as-provenance-only.md)). Where the DAW can label an item (REAPER), the narrator can instead, or as well, keep the sample as a label in the DAW project, so the DAW is the record and the narrator can see it outside the app ([Where a sample is kept](#where-a-sample-is-kept)).
3. **Play it in the app's own audio, served by id.** The host serves a clip by sample id through the existing `/media` handler, never by path, and the page plays it with one shared player ([ADR 0866](../adr/0866-voice-samples-play-in-the-apps-own-audio-served-by-id-and-never-through-the-daw.md)). Playing is refused while a take records, and a Booth session that is listening to the narrator pauses its listening while a sample plays.
4. **Story Bible.** A character entry gets a **Voice samples** section: play, primary, label and note, where it came from with **Open in Editing**, and, after **Edit**, delete and move. Narration's samples sit in the **Voice data** panel.
5. **Booth.** The speaker picker shows a play control on each character who has a sample; **Voices in this scene** does the same and lists every sample; a key plays the primary sample of the current phrase's speaker without leaving the text.
6. **Curation.** One primary sample per character (the one the quick play uses), up to 20 samples a character, rename, move to another character, delete. Provenance that no longer matches the manuscript is labelled **Passage changed** and never blocks playback.

## Key Hypothesis

If a sample is a self-contained clip, the narrator can play it anywhere, with no DAW, no source file and no project of the right version, and the only thing that can make it stale is its own file. We are wrong if clips cost more disk than narrators accept (the limits below are the test), or if hearing a sample in the Booth disturbs a live take or the text-following more than a narrator tolerates (phase 5 measures it).

## What We're NOT Building

- Acoustic comparison of a take against a sample, or any pitch, timbre or drift judgement. Every acoustic binding stays benched ([ADR 0565](../adr/0565-the-series-voice-bible-pools-reference-clips-by-character-id-and-shows-no-books-until-a-second-book-has-data.md), owner ruling on #509). A sample is for the ear.
- Playing a sample through the DAW (REAPER's SWS preview, an inserted track or item). It is REAPER-only, Experimental and refuses while recording ([ADR 0866](../adr/0866-voice-samples-play-in-the-apps-own-audio-served-by-id-and-never-through-the-daw.md)).
- Effects, level matching or cleanup baked into a clip. A clip is the raw source audio; what the DAW's item volume and FX did to it is not in it (open question 5).
- Marking from the Booth's live recognition, from the Script page, or from a rendered or mastered file. Editing's alignment is the only source of word times.
- A sample that spans two takes, two source files or a cut. The narrator picks words inside one stretch of one file.
- Sharing samples between the books of a series, or a global library across projects. Phase 6 treats it; no file outside the project folder is read.
- Choosing the output device for sample playback, a waveform on the player, speed control and looping.
- A change to REAPER's project or to any Lua bridge command in phases 1 to 5. The default storage adds no DAW capability; the DAW-label storage is phase 6 and adds one.
- A mock or page the Studio Next mock lacks beyond this PRD's draft: [ADR 0760](../adr/0760-the-studio-next-mock-is-the-only-spec-for-every-page-it-covers-tokens-primitive-sizes-and-layouts-included.md) says nothing is built that the mock does not show, so the owner approves the draft mock before the UI phases.

## Success Metrics

| Metric | Target | Measured by |
| --- | --- | --- |
| Marking a sample from a selection | Three actions after selecting words: **V**, choose the character, **Enter** | A Playwright test of the Editing page counts the key presses |
| Press to sound in the Booth | The play control shows its playing state within 100 ms ([ADR 0075](../adr/0075-every-action-that-leaves-the-interface-acknowledges-within-100-ms-cannot-be-fired-twice-and-tells-the-narrator-when-it-ends.md)); audio starts within 250 ms on the owner's machine for a primary sample of a character in the chapter | A timing hook in the player, run by the narrator walkthrough on a real build; pending the owner's machine |
| A take is never disturbed by a sample | Zero sample plays while the recorder reports a take; zero text-following moves caused by a sample | A unit test of the guard and the phase 5 listening check; the second is pending a real microphone |
| A moved or re-opened project keeps its samples | 100% of clips play after the project folder is moved, copied to a path with spaces and Unicode, and opened on another machine | The shared path fixture set ([definition of done](../../.claude/rules/definition-of-done.md), rule 1) |
| Disk use | At most 200 MiB of clips a project, refused with a sentence at the limit | A host test at the limit |

## Open Questions

For the owner. Each has a recommendation; none blocks phase 1.

1. **Copy or reference.** Decided 2026-10-17: a setting, not one rule ([Where a sample is kept](#where-a-sample-is-kept)).
2. **What Clear project data and a manuscript replace do.** Decided 2026-10-17: a replace keeps the samples and **Clear project data** removes them.
3. **Reference clips beside voice samples.** Decided 2026-10-17: keep the REAPER-region **Reference clips** as they are, show **Voice samples** above them, and remove only the dead Play stub.
4. **The Booth with a listening session.** Decided 2026-10-17: pause listening while a sample plays and resume after. Phase 5 starts with a spike to confirm the pause can be driven from a sample play; the fallback if it cannot is refusing play during a listening session, which the owner has not chosen.
5. **Raw or as heard in the DAW.** Decided 2026-10-17: raw source audio. Including the item's volume, fades and FX would need a render through the DAW (`render_with_fx`), which is REAPER-only and slow.
6. **Limits.** Decided 2026-10-17: 0.5 to 30 s a sample, 20 samples a character, 200 MiB a project.
7. **Keys.** Decided 2026-10-17: `V` in Editing to mark, `V` in the Booth to hear the current speaker's sample, `Mod+Enter` in the picker to hear the highlighted character. Each is a catalogue row checked for collisions in phases 3 and 5.
8. **Who may manage samples while the entry is read-only.** Decided 2026-10-17: playing, renaming and setting primary work on a read-only entry; **Delete** and **Move** appear only after the narrator presses **Edit**, so a stray click cannot remove a sample ([ADR 0018](../adr/0018-story-bible-entries-read-only-until-edit.md)).
9. **The shape of a DAW label.** Decided 2026-10-17: a REAPER region, which has a start and a duration, so one marker holds the range. The app already parses regions with their GUIDs from the saved project (`tracks.Region`, `character.Service.ListRegions`), and the Reference clips already use the same snapshot-and-compare pattern for a region that changed. A region is in project time, so how it behaves when the narrator moves the item or ripple-edits is for the phase 6 spike to record, with the region's name carrying the character and the label.

## Users & Context

An audiobook narrator who records one book over weeks, often alone, with the manuscript on screen in the Booth. They mark samples while editing a finished chapter, at a desk, with headphones on, and they replay them in the next recording session before a line the character speaks, between takes.

A narrator rarely stops to leave the Booth: the sample has to be one press from the character's name in the text. A narrator who monitors on speakers can send a sample into the microphone, which is why a take that records blocks play.

## Solution Detail

### Core capabilities

| Priority | Capability |
| --- | --- |
| Must | Mark a selected stretch of one take as a sample for a character or Narration, with an optional label and note |
| Must | Hear the stretch before saving, and refuse with a sentence when it cannot be copied |
| Must | List a character's samples in the Story Bible, play, set primary, rename; delete only in the entry's Edit mode |
| Must | Play a character's primary sample from the Booth's speaker picker and side panel; refuse while a take records |
| Must | A clip survives a re-record, a cleanup, a ripple edit, a project move and the loss of the source file |
| Must | A visible state for a clip that is missing or changed, and for provenance that no longer matches |
| Should | A key in the Booth that plays the current speaker's primary sample |
| Should | Move a sample to another character; samples whose character left the Story Bible are listed and can be moved or deleted |
| Should | Prefetch the primary samples of the characters in the chapter when the Booth opens |
| Should | A live event so a second window (the companion) and the open page see a change |
| Could | A small mark in Editing at the end of a marked range that opens the sample |
| Could | Narration samples in the Booth's side panel |
| Won't | Everything under [What We're NOT Building](#what-were-not-building) |

### Storage options

The default of the setting above is the middle column.

| | Reference only | Copy only (recommended) | Copy plus live source |
| --- | --- | --- | --- |
| Stored | Source file, range, hash | Clip file; source kept as provenance | Both, plays the source when it matches and the clip otherwise |
| Disk | None | Up to 4.3 MB a 30 s mono 48 kHz 24-bit sample | Same |
| Raw takes archived or re-recorded | Sample gone or plays the wrong audio | Unaffected | Unaffected, with two code paths |
| Project folder moved | Absolute paths in the `.rpp` and the record break unless re-resolved | Unaffected: the clip is in the folder | Unaffected |
| Ripple, roll, cut, stack, hide | Unaffected: source offsets do not move ([ADR 0860](../adr/0860-a-roll-keeps-the-earlier-audio-as-a-take-and-a-range-cut-a-chain-on-a-range-and-stacking-move-audio-and-never-delete-it.md)) | Unaffected | Unaffected |
| DAW project replaced or the DAW not running | Unaffected only if the source file is still authorized by the parsed `.rpp` | Unaffected | Unaffected |
| Playback start | Seeks inside a chapter-length WAV; the end is found on `timeupdate`, accurate to about 250 ms | A whole short file; exact end | As the source |
| Trust boundary | `/media` must authorize a source by path | `/media` authorizes by id from the host's own list | Both |
| Cost to build | Lowest | Low: `zerocross/wav.go` already writes WAV windows | Highest, and a state matrix for which one played |

### Where a sample is kept

Owner decision of 2026-10-17: this is a setting, because the DAWs differ. REAPER can label items, and keeping the sample there makes the DAW the record the narrator can look at outside the app. Audacity 3's labels are limited, so a copy in the project is better there. The narrator may also want the copy in REAPER, so that playing a sample never moves the place they are at in the project when they need to record.

| Setting | What is kept | Plays from | Available |
| --- | --- | --- | --- |
| **In the project folder** (default) | A clip copy and its record ([ADR 0865](../adr/0865-a-voice-sample-is-a-clip-copied-into-the-project-folder-and-its-source-is-kept-as-provenance-only.md)) | The clip, by id | Every DAW and none |
| **In the DAW** | A region in the DAW project (open question 9, decided) and the record; no copy | The labelled range of the item's source file, by the existing `/media` route, in the app's own audio | Where the DAW declares it can label an item: REAPER, phase 6 |
| **Both** | The clip, the record and the DAW label | The clip | As **In the DAW** |

- The setting is `VoiceSamples.storage` (`project`, `daw`, `both`), layered like the other settings: project, then the narrator's global value, then the repository default `project` ([settings layering](../architecture/daw-integration.md#settings-layering)). It is chosen in Settings, and the **Voice sample** dialog says where the sample will be kept.
- A choice the DAW cannot honour is not offered and says why in the capability's own sentence ([DAW port](../architecture/daw-integration.md#the-daw-port)); a project whose DAW changes keeps the samples it has, and a sample kept only in the DAW reads `label_missing` when the DAW has none.
- In **In the DAW**, the label is the record of the audio's range: the app reads it back from the saved project, so moving or deleting the markers in REAPER moves or ends the sample. The label can lag the live project until the narrator saves it, and the app shows that as the state "not saved in REAPER yet" instead of a stale range.
- Playing in the app's own audio does not move REAPER's transport or cursor in any setting. **In the DAW** is a place to keep and see samples, not a way to play them.
- The first release builds **In the project folder** only (phases 1 to 5). The other two are phase 6, which needs a Lua bridge command with its harness test and an in-REAPER check, a capability row, and its own ADR.

### User flow

1. In Editing the narrator selects the words of a good line (click, **Shift+arrows**, or a phrase with **Mod+arrows**).
2. **V** opens **Voice sample**: character (the speakers in this chapter first, then every character, then Narration), label, note, the range with its words, **Play range**, and **Make primary for Hatter** (on by default when the character has no sample).
3. **Enter** saves. A toast says "Saved voice sample for Hatter" with **Undo** for 10 seconds.
4. In the Story Bible the Hatter's entry shows the sample under **Voice samples**: play, label, length, where it is from, **Open in Editing**.
5. In the Booth, with the cursor on a Hatter line, the narrator presses **V**; the primary sample plays, the text does not move, and **Esc** stops it. Opening the speaker picker shows a play control on each character with a sample.

### Where it is drawn

| Page | Surface | Content |
| --- | --- | --- |
| Editing | Selection toolbar and bar | A **Voice sample** action after **Add FX** (`registerSelectionAction`) |
| Editing | Word menu | **Mark as voice sample…** in its own section (`registerWordMenuSection`) |
| Editing | Dialog | **Voice sample**, the shared modal shell ([ADR 0048](../adr/0048-every-dialog-is-one-modal-shell-and-confirms-are-alert-dialogs.md)) |
| Story Bible | Character entry | **Voice samples** section above **Reference clips** |
| Story Bible | **Voice data** panel | Narration's samples; **Remove voice samples…** beside the existing **Remove voice data…** |
| Booth | Speaker picker (`SpeakerChip`) | A play control on a character's row; an **In this chapter** group once the picker has it |
| Booth | Side panel | **Voices in this scene**: a play control and the sample count on each voice; the samples listed on press |

The draft mock is in [`docs/research/mockups/voice-samples/`](../research/mockups/voice-samples/README.md) and is the **Visual Spec** below.

### States

Every cell is built and tested, or marked "not tested" with its reason, in the pull request that builds the control ([definition of done](../../.claude/rules/definition-of-done.md), rule 3).

| State | Editing dialog | Story Bible section | Booth control |
| --- | --- | --- | --- |
| Empty | Not reachable without a selection; with no words heard: "These words were not heard in the recording." | "No voice samples yet. Mark one in Editing." with **Open Editing** | No play control on a character with no sample |
| One, many, at the limit | The character row says "19 of 20 samples" at 19; at 20: "Hatter has 20 samples. Delete one first." | List sorted primary first, then newest; at 20 the section says so | Plays the primary; the side panel lists all |
| Loading | **Save** shows its pending state ([ADR 0075](../adr/0075-every-action-that-leaves-the-interface-acknowledges-within-100-ms-cannot-be-fired-twice-and-tells-the-narrator-when-it-ends.md)); a second press does nothing | The section reads once on open and on `voice_samples_changed` | The control shows playing within 100 ms; a slow first byte keeps it in that state, then **Couldn't play** |
| Refused | One sentence per reason (see below), nothing saved | A refused delete says why | "Not while recording. Stop the take first." |
| Failed | The sentence names the cause and **Save** stays available | The row stays; a toast says what failed | The control returns to idle and a toast says why |
| Provenance stale | n/a | **Passage changed** badge; **Open in Editing** goes to the chapter and says the words moved | Unaffected |
| Clip missing or changed | n/a | "The audio file is missing" or "The audio file changed since it was saved"; **Check again**, **Delete**; **Mark again** opens Editing when provenance is current | The row is skipped; the picker shows no control |
| Long, right-to-left and emoji labels | Label limit 60 UTF-16 units, note 500 (the bookmark limits); `dir="auto"` | Truncated with the full text in the hint | Truncated |
| Double fire | One sample: the host answers a repeated request token with the first result | Two deletes: the second says "Already deleted" | Play twice restarts; it never overlaps |
| Reload or leave mid-action | The host finishes a save that started; the page shows the sample on return | n/a | Leaving the Booth stops playback ([ADR 0388](../adr/0388-the-booth-is-a-page-keyed-by-its-address-and-only-exit-booth-stops-a-live-session.md)) |
| Recorder state unknown | n/a | Plays | "Can't tell whether a take is recording (last heard 12 s ago)." with **Check again**; refused while a DAW is configured and silent |

**Refusals when marking**, each with a stable code the host returns and a sentence the page shows: `stale_alignment` ("The recording changed since this chapter was checked. Check it again, then mark the sample."), `not_heard`, `spans_takes` ("Choose words inside one take."), `spans_cut` ("Restore the cut words or choose words without them."), `too_short`, `too_long` ("A sample is at most 30 seconds."), `unsupported_source` ("Only WAV recordings can be copied."), `source_missing`, `project_unreadable`, `character_limit`, `project_limit`.

### Keyboard and accessibility

| Where | Key | Does |
| --- | --- | --- |
| Editing | `V` | Opens **Voice sample** for the selection; refuses with the sentence when nothing is selected |
| Dialog | `Enter` saves; `Mod+Enter` saves from the note; `Esc` closes | Native dialog behaviour of the modal shell |
| Booth, in the text | `V` | Plays the primary sample of the current phrase's speaker; again stops it |
| Booth, in the picker | `Mod+Enter` | Plays the highlighted character's primary sample without choosing them; `Enter` still chooses |
| Anywhere a sample plays | `Esc` | Stops it |

- Space stays Record in the Booth and is never bound to a sample, because the foot pedal maps to Space only ([Booth PRD](studio-next-booth.prd.md)).
- A play control is an `IconButton` named "Play voice sample: angry, to the Duke, 7 seconds", and "Stop" while it plays. A polite live region says "Playing voice sample for Hatter" and "Voice sample finished". The progress is real (`currentTime` over `duration`, [ADR 0015](../adr/0015-real-progress-only.md)), a bar and no animation, so reduced motion needs no case.
- A listbox option cannot hold a button, so a picker row's play control is a mouse affordance with `tabIndex={-1}` and `aria-hidden`; the option's description says "Has 3 voice samples. Press Control Enter to hear it", and `Mod+Enter` is the keyboard path. The `Listbox` primitive gains an optional per-option trailing action for this ([ADR 0047](../adr/0047-the-ui-primitives-wrap-base-ui-and-app-code-never-imports-it.md), [ADR 0053](../adr/0053-icon-buttons-text-fields-and-selects-wrap-the-native-controls.md)).
- The dialog is the modal shell: its role tree is pinned by an ARIA snapshot ([ADR 0065](../adr/0065-aria-snapshots-pin-the-role-trees-of-the-dialogs-the-slide-over-and-the-navigation.md)) and every state is run through axe ([ADR 0064](../adr/0064-the-visual-suite-runs-axe-on-every-app-state-and-a-violation-fails-unless-it-is-declared-debt.md)).
- After a delete, focus moves to the next row, or to the section heading when none is left.

### MVP

Phases 1 to 4: mark in Editing, list and play in the Story Bible. Phase 5 (the Booth) is the reason for the feature and ships next; it needs the picker's group and the listening spike.

## Technical Approach

### What is stored

One sidecar folder under the project, written by the host only:

```text
<project>/narration-utils/voice-samples/
  samples.json            schemaVersion 1
  clips/<id>.wav          one clip per sample, id = 32 lowercase hex
```

`samples.json` (shape proposed, pinned by a contract test in phase 1):

```text
{ "schemaVersion": 1,
  "samples": [{
    "id": "9f2c…",                       random, 32 hex
    "characterId": "entity-ab12cd34ef56" or "narration",
    "label": "Angry, to the Duke",       0 to 60 UTF-16 units
    "note": "",                          0 to 500
    "primary": true,                     at most one true per characterId
    "createdAt": "2026-10-17T09:30:00Z",
    "clip": { "bytes": 1331280, "durationMs": 7400, "sampleRate": 48000, "channels": 1, "bitsPerSample": 24, "sha256": "…" },
    "source": {                          provenance only; never opened
      "chapterId": "ch-3", "startKey": "p12:3", "endKey": "p12:9", "text": "words as marked",
      "itemGuid": "{…}", "takeGuid": "{…}", "sourceFile": "C:/…/ch3-take2.wav", "sourceStart": 63.2, "sourceEnd": 70.6 } }] }
```

- **The clip file name is derived from the id.** The host ignores any stored file name, and `source.sourceFile` is a record, not an input: a hand edit of `samples.json` can change a label, a note, the primary flag or the character, and cannot make the host open another path ([data files](../reference/data-files.md#how-the-app-reads-a-file-back)).
- **Read as narrator data** (`persist`): a file that does not decode or breaks a rule (two primaries for one character, a bad id, a label over its limit, a clip size over the cap) is kept aside as `samples.json.corrupt-<time>`; a newer `schemaVersion` is refused and never overwritten. A write is a temp file renamed into place; a clip is written the same way before its row is.
- **Provenance is checked on read, never stored as state** ([ADR 0856](../adr/0856-the-editing-records-are-one-file-per-kind-keyed-by-word-with-its-text-checked-on-read-and-cleared-when-the-manuscript-is-replaced.md) rule 4): `source_state` is `ok`, `text_changed` or `chapter_missing`, computed against the current manuscript. A clip's state is `ok`, `missing` (no file), `size_changed` or `hash_changed`. The host checks size on every list and hash before it serves a clip.

### Marking, in the host

The page sends the chapter id, the item GUID, the take GUID, the range in that item's source file in seconds (from the playlist segment under the first and last heard word), the two word keys, the character id, label, note, `makePrimary` and the alignment record id the times came from. It sends no path.

The host (`internal/voicesample`, a new package, [go-package-split](../../.claude/skills/go-package-split/SKILL.md) rules):

1. Resolves the item and take from the saved `.rpp` by GUID and takes the source file from there. Refuses `source_missing`, `unsupported_source` (not a PCM WAV; the same files Editing decodes) or `project_unreadable`.
2. Compares the alignment record id with the chapter's current one and refuses `stale_alignment` on a difference.
3. Checks the range lies inside the item's played range (`spans_takes` otherwise), outside any cut in `cuts.json` (`spans_cut`), and between 0.5 and 30 s after a 150 ms handle each side, clamped to the played range.
4. Snaps both ends to the nearest zero crossing (`zerocross.Snap`) and copies the window with `zerocross`'s WAV window and header writer, in the source's own format, so no resampling or dithering is involved. ffmpeg is a downloaded asset and is not used.
5. Writes the clip, hashes it, then the row, then answers. A failure after the clip removes it.

### Playback

[ADR 0866](../adr/0866-voice-samples-play-in-the-apps-own-audio-served-by-id-and-never-through-the-daw.md): `GET /media?sample=<id>` in the existing `mediaMiddleware` (one registration, as [ADR 0012](../adr/0012-media-route-for-track-playback.md) asks), which looks the id up in `samples.json`, verifies the clip, and serves `clips/<id>.wav` with `http.ServeContent`. A request with both `path` and `sample`, or a `sample` that is not 32 hex, is a 404.

The page has one `useSamplePlayer`: one `Audio`, one sample at a time, a new play stops the last, Editing's own playback and the Booth's read-aloud speech stop when a sample starts. Its guard reads `control.recording` and the recorder state the Booth already holds. The Booth warms the primary samples of the characters in the chapter (`preload="auto"`) when the page opens.

**While recording and while listening.** The player refuses while `control.recording` is true, with the sentence the Booth already uses for its other controls. A sample played through speakers is also heard by the microphone the Booth's recognition follows, so a Booth session that is listening pauses its listening for the length of the sample and resumes after ([ADR 0033](../adr/0033-the-teleprompter-follows-speech-with-continuous-alignment-and-pause-resume.md)). Whether the pause control is reachable from a sample play is the phase 5 spike. REAPER's own monitoring is unaffected: the app's audio goes to the system's default output and not through the DAW.

### Wire contracts

New ([wire-contract-change](../../.claude/skills/wire-contract-change/SKILL.md), [wire contracts](../architecture/wire-contracts.md)):

| Binding | Answers |
| --- | --- |
| `VoiceSamplesList()` | `{samples: [{id, characterId, label, note, primary, createdAt, durationMs, bytes, clipState, source: {chapterId, chapterTitle, text, startKey, endKey, state}}], totals: {count, bytes}, limits}` |
| `VoiceSampleMark(request)` | `{status: 'saved', sample}` or `{status: 'refused', reason, message}` |
| `VoiceSampleUpdate(id, {label, note, characterId})` | The updated sample, or a refusal |
| `VoiceSampleSetPrimary(id)` | The updated list |
| `VoiceSampleRemove(id)`, `VoiceSamplesRemoveAll()` | `{removed, bytes}` |
| Event `voice_samples_changed` | `{revision}`; the page re-reads |

Each needs a Zod schema in `apps/ui/src/api/schemas/`, a golden payload written by a Go test (`UPDATE_CONTRACTS=1`), a row in `apps/ui/src/api/wireContracts.test.ts`, a mock that passes the schema, a port, an `interactionFeedback` row, and a host API version bump. The source file path and the item and take GUIDs stay inside the host: the page gets `source.state` and the words, as the passage map keeps its ids ([data files](../reference/data-files.md)). The DAW bridge, the Lua files and the capability catalogue do not change in phases 1 to 5. `VoiceSamples.storage` is a new row in `config/defaults.json` (append-only) and in the settings contract; only `project` is accepted until phase 6.

### Data files row (proposed, written in phase 1 when the file exists)

| File | Location | Written by | Read by | Schema or golden | Retention | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `samples.json` | `voice-samples/samples.json` | `VoiceSampleMark`, `VoiceSampleUpdate`, `VoiceSampleSetPrimary`, `VoiceSampleRemove`, `VoiceSamplesRemoveAll` | `VoiceSamplesList`, the media handler (by id) | `voice-samples-*.json` (binding) | Kept through a manuscript replace; removed by **Clear project data** and by deleting a sample. Deleting the file loses every label, note and primary mark; the clips stay on disk but are not listed | Kept aside; a newer version is refused. Limits: label 60, note 500, 20 samples a character, 200 MiB of clips, 30 s a clip. The clip file name comes from the id |
| `<id>.wav` | `voice-samples/clips/` | `VoiceSampleMark` | The media handler, by id | None | Removed with its sample. Safe to delete: the sample then reads `missing` | A PCM WAV in the source's format. Served by id only; never by path |

### Trust boundary and the threat model

A file the app writes and reads back is not a trust boundary, so `samples.json` and the clips get data-files rows only. The change does touch [threat model](../architecture/threat-model.md) row 6b (the `/media` route serves only a project's track sources): it gains a second class, "a clip named by a sample id in `samples.json`, resolved by the host, never by a path from the page". The same row is updated in phase 2 and [SECURITY.md](../../SECURITY.md) needs no change, since the route stays reachable only from the app's own webview. Marking reads a source file chosen by the host from the saved `.rpp`, as the recording check does, and the clip is the narrator's own audio on the narrator's machine: nothing leaves it, and no network call is added.

### Risks

| Risk | Mitigation |
| --- | --- |
| A sample reaches the microphone and moves the text or marks a flag | Refuse while a take records; pause listening while a sample plays; phase 5 spike with a real microphone |
| The alignment is older than the audio, so the copied words are not the marked words | `stale_alignment` refusal against the alignment record id; **Play range** before saving |
| Clips grow the project folder | Limits, a size line in the **Voice data** panel, **Remove voice samples…** |
| Two sections about character audio confuse | Distinct names (**Voice samples** and **Reference clips**), the mock shows both, open question 3 |
| A character renamed, merged or deleted leaves samples behind | `characterId` stays opaque as in `character.Reference`; unknown ids are listed under **Samples for a character that is no longer in the Story Bible** with **Move** and **Delete**; phase 4 checks whether a merge reports the absorbed id and, if so, moves samples |
| An unusual WAV (float, extensible, 8-bit) | The clip keeps the source's format; the supported set is the one `zerocross/wav.go` reads, and anything else is `unsupported_source` |
| The `Listbox` primitive change breaks an existing page | The primitive's atlas stories and the design-spec guard run; the trailing action is optional |
| A narrator expects the processed sound | The dialog and the section say "Raw recording, as it was before editing" (open question 5) |

### Unknowns

- **Booth transcription timestamps.** Whether the Booth persists word timestamps for reuse in Editing is under investigation elsewhere. This design does not need them: Editing's alignment comes from the stored recording check. If they are persisted, they could pre-fill a range from a Booth take later; nothing here depends on it.
- **The alignment record id.** The wire must carry the id of the record Editing's word times came from. Whether `WorkspaceAlignment` already exposes it, or the evidence ledger's record id must be added, is read in phase 1.
- **Words in stacked retries and heard words that are not in the script.** Editing aligns them in ways ([ADR 0855](../adr/0855-heard-words-carry-a-null-score-with-a-reason-and-extra-runs-become-added-words-spread-between-their-ends.md), [ADR 0858](../adr/0858-the-app-may-stack-later-reads-on-the-first-read-and-keeps-each-stacked-takes-offset-and-the-retry-choice-in-an-editing-record.md)) that phase 3 must map to one source range; a selection that cannot map is `spans_takes`.
- **The Booth picker's group.** The real picker has no **In this chapter** group yet; phase 5 depends on the Booth rebuild adding it, or builds the group itself.
- **Pausing listening.** Whether a running listening session can be paused from a sample play ([ADR 0104](../adr/0104-seek-reaches-a-running-teleprompter-session-through-a-tailed-control-file.md) shows how a control file reaches it).
- **A merged Story Bible entry.** Whether the merge binding reports the absorbed id.
- **The DAW region.** Whether the saved `.rpp` the app parses carries the region's name and range as written (`tracks.Parse`, [data files](../reference/data-files.md)); how a region behaves when the narrator moves the item or ripple-edits, since a region is in project time; how "not saved in REAPER yet" is detected ([`DawProjectState`](../reference/daw/capabilities.md)). A spike in phase 6.
- **Key collisions.** `V` is unused in the Editing rows of `apps/ui/src/input/commands.catalog.test.ts`; the Booth rows are checked in phase 5.
- **Speaker preselect.** Whether the Editing page knows the speaker of the selected phrase; if so the character is preselected, otherwise the dialog opens on the speakers in the chapter.

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends |
| --- | --- | --- | --- | --- | --- |
| 0 | Design | This PRD, [ADR 0865](../adr/0865-a-voice-sample-is-a-clip-copied-into-the-project-folder-and-its-source-is-kept-as-provenance-only.md), [ADR 0866](../adr/0866-voice-samples-play-in-the-apps-own-audio-served-by-id-and-never-through-the-daw.md), the draft mock | in review | Yes | None |
| 1 | Store and bindings | `internal/voicesample`: record, WAV window copy, limits, list, update, primary, remove; bindings, schemas, goldens, mock API, port, data-files rows, host API bump. No UI | pending | Yes, with 2 | 0 (owner answers 1, 2, 6) |
| 2 | Playback | The id-keyed branch in `mediaMiddleware`, threat model row 6b, `useSamplePlayer` with the one-at-a-time and recording guards, Storybook | pending | Yes, with 1 after the contract is fixed | 1 |
| 3 | Mark in Editing | Selection action, word menu section, `V` row, the **Voice sample** dialog and its refusals, Editing guide | pending | Yes, with 4 | 1 |
| 4 | Story Bible | **Voice samples** section, **Voice data** additions, orphan and state rows, entry read-only rules, Story Bible guide | pending | Yes, with 3 | 2 |
| 5 | Booth | Spike: pause listening while a sample plays. Then picker play controls with the `Listbox` trailing action, **Voices in this scene**, `V` and `Mod+Enter`, prefetch, the recording and listening guards, Booth guide | pending | No | 2, 4, the picker group |
| 6 | Keep in the DAW | The `VoiceSamples.storage` choices **In the DAW** and **Both**: a spike in REAPER for the label shape, a bridge command to add, move and read back the label with its harness test and in-REAPER check, a capability row, playing a labelled range from its source, the "not saved in REAPER yet" state, a new ADR, the Settings control and the dialog line | pending | Yes, with 5 | 3 |
| 7 | Later | Series pooled view (read-only, [ADR 0565](../adr/0565-the-series-voice-bible-pools-reference-clips-by-character-id-and-shows-no-books-until-a-second-book-has-data.md)), the Editing in-page mark, merge follow, output device | pending | Yes | 4, 5 |

### Phase details

**Phase 6.** Follows the [reaper-command-add](../../.claude/skills/reaper-command-add/SKILL.md) steps: the harness test first for each new command, then the Lua, the Go side, the event table in `apps/desktop/internal/bridge/wire.go`, and a recorded in-REAPER check for what the fake cannot prove. The DAW's own undo applies: adding a label is one undo point ([ADR 0860](../adr/0860-a-roll-keeps-the-earlier-audio-as-a-take-and-a-range-cut-a-chain-on-a-range-and-stacking-move-audio-and-never-delete-it.md) pattern). Audacity 3 is not offered the setting.

**Phase 1.** Go only, so it merges without the mock. Tests: table tests of every refusal; the copied clip decodes to the same samples as the source window (bit for bit); a 30 s limit case and a 200 MiB limit case; corrupt, unreadable and newer `samples.json`; two primaries; delete of the primary promotes the newest remaining; a hand-edited `clip.file` and `sourceFile` are ignored; a fuzz target over WAV headers in the deterministic gate ([ADR 0044](../adr/0044-property-and-fuzz-tests-are-deterministic-in-the-gate.md)); the shared path fixture set for the project folder. Wire: the checks listed under [Wire contracts](#wire-contracts).

**Phase 2.** Tests: the handler serves a listed clip with Range, 404s an unlisted id, a `path` with a `sample`, an id that is not 32 hex and a clip whose hash changed; the player plays one at a time, stops on a new play, refuses while recording, and survives a failed load. No DAW is involved, so no Lua harness test is owed.

**Phase 3.** Built to the approved mock. Tests: each refusal sentence; marking across two takes, over a cut, over unread words and over a stale alignment; the three-action path; the dialog's overlay guard at every window edge, its ARIA snapshot and axe; a state-catalog row and driver for each Editing state. Guide: `docs/guides/using-the-app/editing.md`, screenshots through `scripts/dev/guide-screenshots.mjs`.

**Phase 4.** Built to the approved mock. Tests: empty, one, 20, the limit, a missing clip, a changed clip, stale provenance, an orphaned character, read-only and locked entries, delete with focus return. Guide: `story-bible.md`.

**Phase 5.** The spike comes first and is its own pull request, with a note of what it found. Then the picker, side panel and keys. Tests: the guard while recording and while the recorder reads unknown; the picker option description and `Mod+Enter`; the `Listbox` primitive's atlas stories; prefetch does not play. The narrator walkthrough ([definition of done](../../.claude/rules/definition-of-done.md), rule 2) records a take, plays a sample between takes with headphones and with speakers, and reports what the text did. Guide: `booth.md`.

Every phase's pull request has an **Exercised** and a **Not exercised** section. The `intent-check` pass 2 and the `design-spec-guard` run for phases that touch `apps/ui/src/components/primitives/` (phase 5).

## Decisions Log

| Date | Decision | By |
| --- | --- | --- |
| 2026-10-17 | Where a sample is kept is a setting: the project folder (default, a clip copy), the DAW (a label on the item) or both; the DAW choices only where the DAW can label an item | Owner |
| 2026-10-17 | A manuscript replace keeps samples; **Clear project data** removes them | Owner ("agreed", question 2) |
| 2026-10-17 | **Reference clips** stay; **Voice samples** sit above them | Owner ("agreed", question 3) |
| 2026-10-17 | A Booth session that is listening pauses while a sample plays | Owner ("agreed", question 4); the pause is confirmed by the phase 5 spike |
| 2026-10-17 | Raw source audio; limits of 0.5 to 30 s, 20 a character and 200 MiB a project; keys `V`, `V` in the Booth and `Mod+Enter` | Owner ("go with the recommendations", questions 5 to 7) |
| 2026-10-17 | Delete and Move on a Story Bible entry need **Edit**; play, rename and primary do not | Owner (question 8) |
| 2026-10-17 | A DAW sample is one REAPER region (a marker with a duration), not a pair of markers | Owner (question 9) |
| 2026-10-17 | The draft mock is approved ("mocks look good"). It shows the project-folder storage; the Settings control and dialog line for the DAW choices are drawn in phase 6 | Owner |
| 2026-10-17 | Playback is in the app's own audio, served by id, never through the DAW ([ADR 0866](../adr/0866-voice-samples-play-in-the-apps-own-audio-served-by-id-and-never-through-the-daw.md)) | Owner ("good with the recommendation"); the ADR stays Proposed until the code lands |
| 2026-10-17 | Samples are for the ear: no acoustic comparison | Carried from [ADR 0565](../adr/0565-the-series-voice-bible-pools-reference-clips-by-character-id-and-shows-no-books-until-a-second-book-has-data.md) |

## Research Summary

Read for this design, on 2026-10-17: the Story Bible and character model (`apps/desktop/internal/character`, `bindings_character.go`, `apps/ui/src/components/storybible/`), the Booth side panel, speaker chip and recording guard, the Editing selection registries, key catalogue, playlist and playback hook, the stored recording-check words and the evidence ADRs ([ADR 0100](../adr/0100-analysis-evidence-is-two-hash-keys-one-ledger-record-per-run-and-a-narrator-confirmed-track-map.md), [ADR 0128](../adr/0128-the-coverage-service-reads-the-saved-project-keeps-words-per-source-range-and-leaves-model-and-language-out-of-the-parameter-hash.md)), the `/media` route and its threat-model row, the DAW `file_preview` capability, [data files](../reference/data-files.md), the user guides for the Story Bible and the Booth, and the Studio Next mock's speaker picker. Nothing was run: the design rests on code and documents, and every measure above is pending a build.

## Visual Spec

The Studio Next mock does not cover this feature. The draft mock in [`docs/research/mockups/voice-samples/`](../research/mockups/voice-samples/README.md) shows the Editing dialog and toolbar action, the Story Bible section and its states, the Booth picker and side panel, in light and dark. It was approved by the owner on 2026-10-17 ([ADR 0760](../adr/0760-the-studio-next-mock-is-the-only-spec-for-every-page-it-covers-tokens-primitive-sizes-and-layouts-included.md): a new mock is added for work being built now and deleted in the pull request that merges that work). Phases 3 to 5 build to it, and the one that merges last deletes it.

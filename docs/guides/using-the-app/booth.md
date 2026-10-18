[Using the app](README.md) › Booth

# Booth

The Booth is where you record. It shows the chapter's text large, follows your voice through it with a local speech engine, and
starts and stops the take in your DAW (or the built-in recorder). It needs an [imported manuscript](production.md#importing-the-manuscript).
Open it from **Booth** in the navigation, or from **Record in Booth** on a chapter or credits card on [Script](script.md), which
opens it on that chapter. What the Booth is reading is part of its address (`/booth?chapter=…`, `/booth?credits=opening`), so Back
and a link land on the same chapter. The Booth fills the window and follows the app's theme, light or dark.

## The page

The top bar holds the chapter stepper (previous chapter, the chapter menu with the opening and closing credits, next chapter),
where you are (`¶ 1 of 24 · 0% · ~13:48 finished left`), the resume line, and a chip naming the recording setup (the DAW, or the
built-in recorder). The chip opens [Settings](settings.md). The chapter is named as the manuscript heads it
(`CHAPTER I. Down the Rabbit-Hole`). **Text settings** chooses the font, the same choice as the reader font on
[Script](script.md), and the Booth's text size, 24 to 72 px; **+** and **-** change the size too, and the Booth opens at the size
you last chose. The button at the right shows or hides the side panel; in a window 1280 pixels wide or narrower the panel is a
drawer that starts closed, the chapter picker is narrower, and the top bar wraps onto a second row when it runs out of room.

![Booth - the Text settings: the font and size of the text you read](../../images/ui/booth-text-settings.webp)

The chip says when the project's DAW is not ready: **REAPER · not linked**, **REAPER · not running**, or REAPER on
its own once connected. Click it to fix that in [Settings](settings.md#link-your-reaper-project).

![Booth - the top-bar chip warns REAPER · not linked](../../images/ui/booth-daw-not-linked.webp)

![Booth - ready to record: the chapter stepper, progress and resume line on the top bar, the text with the reading position, the side panel, and Record, the levels and the key hints in the footer](../../images/ui/booth-setup.webp)

The text fills the middle, with speaker chips beside the lines a character speaks, Story Bible names tinted and the words you
marked on [Script](script.md) underlined in their mark's colour; a mark's note shows under its paragraph. The word you
are on is marked with a caret; the text scrolls to keep it in view as you read. The mouse wheel and Page Up and Page Down move
the view without moving your place.

Clicking a Story Bible name, a marked word or a note shows it in the side panel's **Reference**, read-only: the entry, or the
mark with its note and its replies. A click on another word or on empty space clears it. The side panel also has the suspected
lines of this take, **Last punch**, **Voices in this scene** (the characters nearby, with their voice notes), **Coming up** (the
next names with a pronunciation) and **This session** (how long you have recorded and how many punches). In a
[pickup session](#a-pickup-session) the pickup lines come first.

The footer has **Record**, the take's timer, **Levels** (the microphone in use and two sliders), a level bar and the room tone
the recorder reports for that microphone (**Room not measured yet** until it reports one), and the keys the Booth answers, drawn
from your keymap. In **Levels**, **Monitor level (output)** sets how loud the DAW plays back to you (0 to 100, 70 is its normal
level; REAPER's first hardware output, so the files you render are not changed). **Input level** is shown but off, with the reason:
no DAW can set an audio interface's input gain, so set it in your interface's own control panel.

![Booth - the Levels menu: the input level and the microphone the text listens to](../../images/ui/booth-levels-menu.webp)

## Recording

Press **Record** (or Space, or a foot pedal mapped to Space) to start a take, and again to stop it. Record arms only the chapter's
track and starts at the end of the last item on it, so a take never records over an earlier one. When Record cannot start it is
disabled and the footer says why, in the DAW's own words: the DAW is not running, the record action is switched off in Settings,
the chapter has no track, or the DAW is already playing. When the reason is a missing or doubled track link, the footer also
offers **Open the audio engine panel**, where **Chapter links** sets the chapter's track.

![Booth - six seconds into a take: the text follows the voice](../../images/ui/booth-following.webp)

When the reason is one you can fix from the Booth, a box above the footer shows the steps:

- **Recording in REAPER is experimental.** Recording in a DAW starts switched off until it has been checked in that DAW.
  **Turn on Record** turns it on for this computer (Settings > DAW Integration > Record), and Record is ready at once.

  ![Booth - Record disabled with the reason in the footer, and the Recording in REAPER is experimental box above it with Turn on Record and DAW settings](../../images/ui/booth-record-refused.webp)

- **Connect REAPER to record** (or **REAPER is not answering**). The app records in REAPER through a small script, the
  launcher, that runs inside REAPER. Load it once: in REAPER, choose **Actions > Show action list > New action > Load
  ReaScript** and pick the launcher file the box shows (**Copy path** copies it). Load it again after you update the app,
  because the file moves with each update. Then, with the chapter's project open in REAPER, run
  **Script: NarrationUtils_Launcher.lua**. The app connects and Record turns on. **Open in REAPER and
  connect** opens the linked project with the launcher in one go, or connects the REAPER you already have open, and from then on Launch REAPER always starts it. If no
  REAPER project is linked yet, the first step links it.

  ![Booth - the Connect REAPER to record box, with the two steps and Open in REAPER and connect, above the disabled Record button and its reason](../../images/ui/booth-record-setup.webp)

  Both boxes say what they are waiting for ("Waiting for REAPER to connect") and when the app last looked ("Last checked 4 s
  ago"). The Booth asks again by itself every few seconds while it waits, when you come back to its window, and when you press
  **Check again**. If REAPER stops answering, the box says so instead of showing an old answer as fact. In a short window the
  steps fold into one line, **Steps to connect**, so the text keeps room to read.

  If the app is busy (an import, a build or a download is running) when REAPER starts and hands over its project, the app
  keeps the project it has and says so, in the box and in a message that stays until you dismiss it. Finish or cancel what is
  running, then press **Open in REAPER and connect** again.

  ![Booth - REAPER started from the Connect box, but the app was busy and turned its project away: the box says so and what to do](../../images/ui/booth-record-turned-away.webp)

- **REAPER has a different project open.** REAPER answers, but the project it has open is not the one linked here, so a take
  would not land where the book expects it. **Link the open project** opens the project picker (choose the file REAPER has
  open); or open the linked project in REAPER and press **Check again**. The Booth also asks again every few seconds while the
  box is up, and by itself every 15 seconds otherwise, because REAPER sends no message when another project is opened.

  ![Booth - REAPER has a different project open: the box offers Link the open project, DAW settings and Check again](../../images/ui/booth-record-other-project.webp)

  Record also says why when REAPER already has a take running that the app did not start ("REAPER is already recording. Stop
  it in REAPER before recording here.") and when REAPER does not answer. It is ready again as soon as that is fixed, without a
  restart.

  A message is never drawn over these boxes: it rises above them. The same sentence is one message however often it is asked
  for, and a message about REAPER starting goes as soon as Record is ready.

### Recording without a DAW

A project can record with the built-in recorder instead of a DAW: choose it in [Settings](settings.md) > Recording. It records on
Windows only. The setup chip reads **Built-in**, Record needs no track or DAW project, and each take is saved as a new audio file
in the project's `Recordings` folder (`Take 001.wav`, `Take 002.wav`, …); an earlier take is never overwritten.

![Booth - a project that records with the built-in recorder: the chip reads Built-in, and Record is ready with no track to link](../../images/ui/booth-builtin-setup.webp)

- **Experimental.** Like recording in a DAW, it starts switched off until it has been checked on your microphone. The box above
  the footer says so and **Turn on Record** turns it on, the same switch as in Settings > DAW Integration > Record.

  ![Booth - the built-in recorder with Experimental actions off: Record disabled with the reason, and the Recording in the built-in recorder is experimental box above it with Turn on Record](../../images/ui/booth-builtin-refusal.webp)

- **The microphone.** The take records on the microphone you chose in **Levels**. With none chosen it uses the one the project
  last recorded with, then the only one the computer lists. With several listed and none chosen, Record says **Choose the
  microphone in Levels, then press Record**; with none listed it says **No microphone found** and why. A microphone Windows
  will not let the app open (another program has it, or the privacy setting blocks it) is refused in the recorder's own words and
  nothing records.
- **A take.** Record becomes **Stop** and the **REC** pill shows, as with a DAW.

  ![Booth - a take recording with the built-in recorder: Stop in place of Record and the REC pill beside the Built-in chip](../../images/ui/booth-builtin-listening.webp)

- **A take that ends by itself.** If the microphone is unplugged or the disk fills, the take stops and a message says why and
  that the audio before it is kept in the `Recordings` folder (a take cut short keeps a `.partial` name and is listed as
  unfinished). Record is ready for the next take.

  ![Booth - the built-in recorder's take ended by itself: Record is back and a message says the audio before it is kept in the Recordings folder](../../images/ui/booth-builtin-take-ended.webp)

- **Leaving.** Leaving the Booth during a take asks "Stop recording?", as with a DAW. Reloading the window during a take picks the
  take up again, and Stop still stops it. Turning Experimental off during a take does not stop the take, and Stop still works.
- **Not yet.** **R** (punch and roll) is not available with the built-in recorder, and the footer's Levels cannot set an audio
  interface's input gain: set it in the interface's own control panel.
- **Where the takes go.** The Booth does not link a take to its chapter. Assign it in the native takes of the
  [chapter view of Proof](proof.md#the-chapter-view), which is also where the keeper is chosen.

If you stop a take in the DAW itself, the Booth sees it and says so, and Record is ready for the next take. If REAPER stops
answering mid-take, the Booth says it can't tell whether the take is still running, and to check REAPER, instead of keeping a REC
pill it cannot vouch for. Another project opened in REAPER mid-take does not stop the take; the footer says what changed.

![Booth - a take recording: Stop in place of Record, the REC pill beside the setup chip and the take counted in This session](../../images/ui/booth-listening.webp)

While a take runs, Record becomes **Stop**, a **REC** pill shows beside the setup chip and the timer counts. The timer is the
clock's: a window that slept or sat in the background shows the true time when you look at it again. A question that holds the
reading ("Stop recording?", a menu) does not stop the DAW: the pill then says **REC · reading paused** and the timer goes on. The
chapter cannot be changed until you stop, and the chapter arrows and the chapter list say so when you hover or focus them. When listening reaches the last word of the chapter and stops, the take stops with it and a message says
**Take saved**. Reading on past the end keeps the take running.

**R** punches and rolls from the word you are on: the DAW plays in from a little before it and records from there, keeping the
earlier audio as a take. Pressed again within a moment, it rolls once, not again. Where the DAW would replace the audio instead (Audacity without backups), the Booth asks first ("Roll
again from ¶ n?") and holds the take while it asks.

Click a word to start from it. **↑** and **↓** move by phrase, **←** and **→** by word, **=** and **-** change the text size, and
**F11** takes the window full screen.

Right-click the text for **Start from here** (on a phrase), **Bookmark here** (on a word), **Next phrase**, **Back one phrase**,
**Punch and roll**, **Larger text**, **Smaller text** and **Exit Booth**. **Start from here** marks where the next take starts;
during a take it rolls again from that phrase, as **R** does. A take is held while the menu is open.

While a popover, a menu or a question is open (Levels, Text settings, a speaker, the chapter list, the jump menu, "Stop recording?"), no key reaches the Booth behind it: a foot pedal's Space cannot start or stop a take until it is closed. Escape closes the one on top and returns you to the control that opened it.

The engine and model the Booth listens with are chosen in [Settings](settings.md) › Booth. Nothing you say is sent anywhere.

### The microphone the Booth listens to

The text follows your voice through a microphone of its own choosing. With a DAW, the Booth listens to the microphone the DAW
records from when the DAW names it, and **Levels** shows its name with **Chosen in** and the DAW's name. When the DAW cannot say,
**Levels** lists the microphones on this computer with the DAW's reason, and the footer says **Choose the microphone the Booth listens
to in Levels**. A microphone you chose is never replaced. The choice is remembered for every project.

![Booth with no microphone listed: the footer says the text cannot follow the voice](../../images/ui/booth-no-mic.webp)

If the speech model is not downloaded yet, the footer says so before you press Record ("The text cannot follow your voice yet"),
and the first take asks to download it, says how large it is and where it goes, and
downloads nothing until you press **Download model**. While the text cannot follow (no microphone listed, or the listening failed
to start), the footer says why; the take still records.

![Booth - Record pressed with the live engine's model not installed: the take runs and the Booth asks about the model](../../images/ui/booth-model-required.webp)

## Where you stopped

When the chapter's track already has a recording, the top bar offers **Resume at ¶ n** and says where it read that from: the
DAW now, the saved project, or the Booth's own record of your last reading. Choosing it moves your place to where the recording
ends; nothing starts until you press Record.

![Booth - Resume at ¶ 14 chosen: the reading position moved to where the recording ends](../../images/ui/booth-waiting.webp)

## Bookmarks

The chapter's [bookmarks](script.md) show as ribbons in the right margin of the text, beside their words; hover one for its label
and note, and click it to edit it. A bookmark whose line changed since it was made is a warning mark at the top of the margin.
**B** bookmarks the word you are on, with **Undo** on the message. **Alt+]** and **Alt+[** move to the next and previous bookmark,
into another chapter when needed; during a take they move only within the chapter, and a bookmark in another chapter waits until you stop recording. Right-click a ribbon for **Edit bookmark** and **Delete bookmark**.

![Booth - B pressed: the word being read is bookmarked, with a ribbon in the margin](../../images/ui/booth-bookmark.webp)

## A pickup session

**Open N in Booth** on [Pickups](pickups.md#pickup-session) opens the Booth on the chosen lines, at the first line's chapter. A
**Pickups · N open** chip on the top bar counts the lines still open, and the side panel lists them first, each with its chapter
and time; a recorded one has a tick. Click a line, or press **N** and **Shift+N**, to go to the next or previous one, in another
chapter when needed (not during a take). A line the recording check found is tagged **Automatic**; dismissing it removes it from
[Pickups](pickups.md) as well.

![Booth opened from Pickups: the pickup session in the top bar, at the line to record](../../images/ui/booth-pickup-session.webp)

When a take stops, the lines it read over are marked recorded, and the message says how many ("Take saved · 2 pickups marked
recorded") with **Undo**.

## Suspected lines

While you read, the Booth marks places where listening suspects something went differently from the script, such as skipped
words or a restart. They are listed in the side panel, where **Dismiss** removes one from the list. Every
one is only suspected: Transcript Compare over the recording is the authority.

## The credits

The chapter menu also offers **Opening credits** first and **Closing credits** last, when your credit template library
([Settings, Credits](settings.md#credits)) has an opening or a closing template. The text is the first template of each kind filled
in with the project's values, exactly as Settings previews it. If a value is missing, for example no narrator name yet, the
placeholder shows in brackets (such as [Narrator]) and a chip on the top bar says how many tokens have no value; it opens the
Credits settings. You can still record.

![Booth - the closing credits, with the warning chip for tokens that have no value](../../images/ui/booth-credits.webp)

## Companion mode

The Companion is a narrow panel pinned beside your DAW. Open it with **Open Companion** in the jump menu (its key is in the shortcut sheet): the
reading session, with REAPER's playhead in its header, the script in its own scroll box, the reading controls and the hotkeys
that work while the panel has focus. **Full app** (or Escape twice) brings the Booth back on the same chapter. **Pickups** in the
panel shows the [Pickups](pickups.md) list: how many are left and the one you last jumped to. The note at the playhead has its
place in the panel and is coming later.

![The Companion, the Booth's small window beside your DAW](../../images/ui/booth-companion.webp)

## Leaving the Booth

Escape (when nothing is open on top of the Booth) takes you to Script. While a take is recording, every way out asks first
(Escape, Back, Forward, the setup chip, a link to another chapter): "Stop recording?" says the DAW is recording and leaving
stops it. The take is held while the question is open. **Keep recording** stays; **Stop and leave** stops the recording and then leaves. If the DAW was already recording
when you came in, the Booth did not start that take and does not stop it, and the question says so.

![Booth - Escape during a take asks "Stop recording?", with the take held until the narrator answers](../../images/ui/booth-flag.webp)

---

[← Story Bible](story-bible.md) · [Index](README.md) · [Editing →](editing.md)

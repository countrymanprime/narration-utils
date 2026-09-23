[Using the app](README.md) › Teleprompter

# Teleprompter

The Teleprompter follows you as you read a chapter aloud: it listens through your microphone
with a local Whisper model and highlights the word you are on. It needs an [imported manuscript](home.md),
and nothing you say is edited, saved, or sent anywhere.

Choose the chapter, pick your microphone from the list (Refresh if you just plugged one in), and
pick a model. Tiny is the fastest and keeps up on most computers; Small is more accurate but needs
a faster one. The first time you start, the app asks before downloading the model. Your microphone
is remembered for next time; if it is no longer connected it shows as "(not found)" until you pick it
again or choose another. A microphone can only be picked from the list, never typed: with none listed,
the page says "No microphone found" and Start reading stays disabled until you connect one and press
Refresh.

![Teleprompter before a session, with the chapter, microphone and model choices above the chapter text](../../images/ui/teleprompter-setup.webp)

Press Start reading and begin at the top of the chapter, title first. The setup fields fold away
into a bar that stays at the top with the status and a Stop button. Words you have read dim, the
word you are on is filled in, and the page scrolls to keep it near the middle of the screen.
The highlight follows what it hears, not a timer, so it waits when you do. The key above the text
shows the three looks: current word, word read, and skipped (a dotted underline).

While it is listening you can click any word: a word ahead starts reading from there, and a word you
have already read takes you back to it.

![Teleprompter listening, with read words dimmed and the current word highlighted](../../images/ui/teleprompter-listening.webp)

You do not have to read perfectly. If you skip a word or two it carries on and underlines the
words you missed; if you go back and re-read a sentence it goes back with you. If you stop for
a moment the status says it is waiting for you to return to the script, and it picks up again
as soon as it hears you.

![Teleprompter waiting after the narrator paused](../../images/ui/teleprompter-waiting.webp)

When you reach the end of the chapter the status says Done. Press Stop to end the session. You
can leave the page while it runs; coming back shows where you were.

---

[← Story Bible](story-bible.md) · [Index](README.md) · [Tracks →](tracks.md)

[Using the app](README.md) › Delivery

# Delivery

Delivery measures your rendered chapter files, so you can check them before handing them to a
reviewer or a distributor without another tool. For each file it shows the integrated loudness (LUFS),
the RMS level, the sample and true peaks, the noise floor, the length and how many windows were
digital silence, each with its unit. Your files are only read, never changed, and Delivery is always in
the navigation: it needs neither a manuscript nor a REAPER project.

![Delivery page before anything is measured, with no limits set](../../images/ui/delivery-empty.webp)

## Measuring files

Press **Choose files to measure…** and pick one or more rendered chapter files. Only WAV files are
measured for now; a file in another format, or one that cannot be read, is listed with the reason and
does not stop the others. The bar shows how much of the audio has been read so far, and **Cancel**
stops the measurement: files already measured keep their results. You can leave the page while it
runs; the app says when it ends, and Delivery shows the last measurement when you come back.

![A measurement in progress, with its real progress and Cancel](../../images/ui/delivery-running.webp)

A value that could not be measured says **Not measurable**, never a number: a silent render has no
loudness or noise floor to measure, and a very short file has too little audio for some of them. It is
never counted as within a limit.

![Three files measured: every value with its unit, a silent render not measurable, and an MP3 that could not be read](../../images/ui/delivery-measured.webp)

## Your limits

The limits are your own, set in [Settings, Delivery](settings.md): no distributor's
numbers are built in. Until you set one, **Your limits** says **No limits set**, and every value is
reported without being checked, so nothing on the page reads as a pass. **Change limits** opens that
Settings category.

With limits set, the page lists them, marks each value outside one in red with the limit it broke
("above −3.5", "below −20.0"), and counts them under the measurement's result. Changing a limit
in Settings judges the values on screen again, without measuring the files again.

![Measured values against the project's own limits, with three outside them](../../images/ui/delivery-outside-limits.webp)

## Diagnostics

The **Diagnostics** tab checks the same kind of files for clipping, level shifts, room-tone changes
and long pauses. Press **Check the measured files** to check what you just measured, or **Choose
files to check…** to pick others. First say what the files are, **Rendered chapters** or **Raw
recordings**: room tone and level mean different things in each, because a render may have been gated
or cleaned on purpose, so a room-tone change in a render is only information. The bar shows the audio
read so far, and **Cancel** keeps what was already checked.

Each file gets a line with its length, how many clip regions and level shifts it has and how much of it
is silence. Pacing and the speaking rate need the transcript's word timing, so a file checked here says
**Not available** with the reason, and no long pause is guessed from silence alone.

Under it, each finding gives its time in the file, what it is and why it was raised, what was measured
(for example the loudness before and after a level shift), the threshold that raised it, and the file
and the kind of source it was measured in. Listen at those times in REAPER: the tab plays nothing,
changes nothing and saves nothing, so every finding is a candidate to listen to, not a verdict, and
stays unreviewed. **Thresholds** lists every threshold the check uses, even before you check anything.
They are starting values, not a delivery specification, and cannot be changed yet. When nothing reaches
a threshold, the tab says so without calling the file a pass.

![The measured files checked: each file summarised, and each finding with its time, what was measured, the threshold that raised it and the source](../../images/ui/delivery-diagnostics-findings.webp)

---

[← Review](review.md) · [Index](README.md) · [Settings →](settings.md)

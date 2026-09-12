# Manuscript Guide

Builds a narrator reference from a Word manuscript. It lists candidate characters, places, and
organizations; stores editable pronunciations, IPA, descriptions, evidence, and conservative
personality notes; and can create local Piper WAV previews.

It is not dependent on Transcript Compare. The two tools deliberately share one project-level
input only:

```
<project folder>\Manuscript.docx
```

Either tool's **Select Manuscript** action may replace that file. This tool never reads or
writes Transcript Compare's ExtState values or generated files.

## Layout

- `core/` — the DAW-agnostic Python backend (`manuscript_guide.py`), its `requirements.txt`,
  and its tests. No DAW APIs are used here; it's a plain CLI invoked by whichever DAW driver
  below is running it.
- `daws/reaper/` — the REAPER ReaScript driver (currently the only implemented one).
- `daws/audacity/` — placeholder for a future Audacity driver.

## Install (Reaper)

From `core/`, create its own runtime and install dependencies:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m spacy download en_core_web_sm
```

In REAPER, use **Actions → Show action list → New action → Load ReaScript...** to load all
three files in `daws/reaper/`:

- `ManuscriptGuide_Run.lua`
- `ManuscriptGuide_Configure.lua`
- `ManuscriptGuide_SelectManuscript.lua`

Run **Manuscript Guide - Configure** once. The default Python/backend paths are derived from
the reascript's own location, so they already point at `core/` in your checkout — no matter
where you cloned the repo. Select a manuscript with either tool's selection action; it is
copied beside the `.rpp` as `Manuscript.docx`.

## Use

1. Run **Manuscript Guide - Run**. It detects a missing or changed shared manuscript and asks
   to build/rebuild only its own guide.
2. Search the guide, select an entity, then edit its category, aliases, narrator-friendly
   `Say it as` value, IPA, description, personality note, and locked fields. Locked fields
   survive a rebuild.
3. **Export all** writes `ManuscriptGuide\whisper_hotwords.txt`. It is a standalone reference;
   copying it into a transcript tool is an explicit user action.
4. For playable WAV previews, configure a local Piper executable and voice model, then choose
   **Play preview**. eSpeak NG is optional but enables an IPA fallback for unknown names.

## Project files

The guide keeps all of its outputs in `<project>\ManuscriptGuide\`:

- `manuscript_guide.json` — canonical, editable guide data
- `audio\` — cached Piper WAV previews
- `whisper_hotwords.txt` — independent export
- transient progress/index/status files

The initial extractor is deliberately conservative. It uses local spaCy when available, plus
name/context rules when it is not, and marks uncertain entries as **Needs Review**. Personality
notes are limited to direct trait words with their manuscript excerpt; no cloud provider or
unsupported AI interpretation is used.

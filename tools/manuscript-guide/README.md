# Manuscript Guide

Builds a narrator reference from a project-owned canonical manuscript. It lists candidate characters, places, and
organizations; stores editable pronunciations, IPA, descriptions, evidence, and conservative
personality notes; and can create local, catalog-managed Piper WAV previews.

It is not dependent on Transcript Compare. The two tools deliberately share one project-level
input only:

```
<project folder>\narration-utils\manuscript\manuscript.json
```

The Narration Utils workspace's **Import manuscript…** flow may replace that
file after confirmation. This tool never reads or writes Transcript Compare's settings or
generated files.

## Settings: global vs. this project

Settings (spaCy, eSpeak, and the TTS provider/voice selection) are layered: a repo-wide default, a per-user
**Global Defaults** value, and an optional **This
Project** override, in that order. Global values live in
`%APPDATA%\narration-utils\global-settings.json`; a project override lives in
`<project folder>\narration-utils\settings.json`, alongside (not inside) the per-tool
`ManuscriptGuide\` output folder. Both are DAW-agnostic plain JSON, not REAPER ExtState, so a
future Audacity adapter can reuse the same settings store instead of needing its own. Open
either scope from the workspace's corner **Settings** button.

## Layout

- `core/` — the DAW-agnostic Python backend (`manuscript_guide.py`) and its tests. No DAW APIs
  are used here; it's a plain CLI invoked by whichever DAW driver below is running it. Its
  dependencies are declared in the repo-root `requirements.txt`.
- `daws/reaper/` — reserved for a future dedicated adapter; current REAPER integration is
  centralized in `shared/reaper/narration_ui_bridge.lua`.
- `daws/audacity/` — placeholder for a future Audacity driver.

## Install (Reaper)

From the repository root, run the shared quickstart script. It creates the
repo-wide `.venv`, installs every tool's dependencies, and downloads the default
spaCy model:

```powershell
.\scripts\Quickstart.ps1
```

In REAPER, use **Actions → Show action list → New action → Load ReaScript...** and load just
one file, `shared/reaper/NarrationUtils_Launcher.lua` — it's the only script either tool needs
imported into REAPER's Action list. Running it opens the persistent, centered
**Narration Utils** workspace. Select the manuscript, open either utility, or
use the corner **Settings** button without leaving that window.

Python backends run only from repo-managed local environments created by the
quickstart script, so REAPER never needs to know or configure Python. Select a
manuscript from Home; it is normalized into canonical JSON and its source is retained for provenance.

## Use

1. Run **Narration Utils**, open **Manuscript Guide**, and choose **Build / refresh** when the
   shared manuscript is missing or changed.
2. Search the guide, select an entity, then edit its category, aliases, narrator-friendly
   `Say it as` value, IPA, description, personality note, and locked fields. Locked fields
   survive a rebuild.
3. **Export all** writes `ManuscriptGuide\whisper_hotwords.txt`. It is a standalone reference;
   copying it into a transcript tool is an explicit user action.
4. Choose a local TTS provider and preview voice in Settings. **Play preview**
   asks for explicit download approval if that reviewed voice is missing, then
   creates a cached WAV for the exact name or alias. eSpeak NG is optional but
   enables an IPA fallback for unknown names.

## Project files

The guide keeps all of its outputs in `<project>\ManuscriptGuide\`:

- `manuscript_guide.json` — canonical, editable guide data
- `audio\tts\` — cached Piper WAV previews, invalidated when the spoken text or voice version changes
- `whisper_hotwords.txt` — independent export
- transient progress/index/status files

The initial extractor is deliberately conservative. It uses local spaCy when available, plus
name/context rules when it is not, and marks uncertain entries as **Needs Review**. Personality
notes are limited to direct trait words with their manuscript excerpt; no cloud provider or
unsupported AI interpretation is used.

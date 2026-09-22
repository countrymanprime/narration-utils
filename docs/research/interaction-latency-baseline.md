# Interaction latency baseline

**Measured 2026-09-21.** Phase 1 of the [interaction feedback audit](../prds/interaction-feedback-audit.prd.md): how long the Story Bible operations and the heavier Go calls take, so the feedback standard ([ADR 0075](../adr/0075-every-action-that-leaves-the-interface-acknowledges-within-100-ms-cannot-be-fired-twice-and-tells-the-narrator-when-it-ends.md)) rests on numbers. The numbers are one machine's, and the frozen sidecar was measured from a build made for this run, not from a release.

## Method

- **Harness.** `apps/desktop/internal/latency/latency_test.go`, a Go test under the `latency` build tag (not in the gate). It drives the real `guide.Service` through the real `process.Supervisor.Run`, so each timed operation includes what the app pays: starting the process, importing the module, reading and rewriting `manuscript_guide.json`, and reading the output. How to run it is at the top of the file.
- **Runs.** 20 per operation (5 for "seed 10", which is ten spawns each). The first run is reported alone as the closest an unprivileged process gets to cold (the operating system's file cache cannot be dropped without administrator rights, so **a true cold start was not measured**); p50, p95 and max are over the 19 runs after it. Operations that consume an entry (`delete`, `merge`) create their entries before the timer starts.
- **Manuscripts.** Synthetic, generated deterministically by the harness: a small one (2,225 words, 3 chapters) and a full-length one (88,471 words, 30 chapters, 1,200 paragraphs). No real full-length manuscript was available (the `Challenges_001` project holds audio and a `.rpp`, no manuscript), so **the build numbers are for synthetic text**; a real manuscript has longer sentences and more names, and `LATENCY_MANUSCRIPT` runs the harness on one.
- **The `.rpp`.** A read-only copy of `Challenges_001.rpp` (101 KB, 41 items) was parsed; nothing in that folder was modified.
- **Machine.** Windows 11 Home 10.0.26200, AMD Ryzen 9 9955HX (16 cores), 31.2 GB RAM, SSD. **Microsoft Defender real-time protection was off**, which is the kindest case for process starts; a machine with antivirus scanning every new process will be slower, most of all on the first start of a frozen executable. Go 1.27.1, Python 3.12.10 (the repository's `.venv`), PyInstaller 6.22.3 (`--onedir`, built by `scripts/release/prepare-resources.py --sidecar manuscript-guide` from this tree). Other applications were running; nothing else was started during the two timed passes.

## What was not measured

- **spaCy.** `en_core_web_sm` is not installed in the venv (installing it means downloading a model, which needs the owner), so `build` ran on the rule-based extractor the sidecar falls back to. A real build adds the model load; `import spacy` alone costs about 670 ms.
- **The Piper voice.** No voice is installed, so `render-audio` (the preview) was measured only up to the point the voice would load, by asking for a model that does not exist. That is a **lower bound** for an uncached preview: it omits loading the voice and synthesizing.
- **A real cold start and antivirus** (above), **a real manuscript** (above), and a machine under load.
- **The install flows** (downloads) and the transcript comparison, which are jobs with their own progress, not blocking calls.

## Story Bible operations (each a Python process)

Every row is at least 280 ms, so **every Story Bible mutation is above the 100 ms acknowledgment threshold** and none had an acknowledgment before this audit.

| Operation | Dev venv, p50 (ms) | Dev venv, p95 (ms) | Frozen, p50 (ms) | Frozen, p95 (ms) | Proposed tier |
| --- | --- | --- | --- | --- | --- |
| edit, 1 field | 310 | 355 | 313 | 351 | 2 |
| setLocked | 327 | 348 | 318 | 343 | 2 |
| rescan | 317 | 352 | 320 | 351 | 2 |
| relate | 320 | 345 | 320 | 344 | 2 |
| merge | 294 | 347 | 321 | 347 | 2 |
| delete | 316 | 345 | 294 | 343 | 2 |
| create | 554 | 582 | 374 | 393 | 2 |
| edit, aliases (pronunciation) | 621 | 823 | 378 | 390 | 2 |
| preview, lower bound (no voice load, no synthesis) | 321 | 364 | 301 | 333 | 3 |
| **Save, 4 fields (4 spawns)** | **1,247** | 1,315 | **1,235** | 1,278 | 3 |
| build, small | 1,433 | 1,475 | 1,095 | 1,109 | 3 |
| **seed 10 candidates (10 spawns)** | **6,479** | 6,736 | **3,677** | 3,695 | 3 |
| the same on the full-length manuscript: | | | | | |
| edit, 1 field | 439 | 460 | 441 | 462 | 2 |
| setLocked | 455 | 679 | 448 | 466 | 2 |
| rescan | 469 | 505 | 472 | 492 | 2 |
| relate | 439 | 488 | 468 | 510 | 2 |
| merge | 444 | 474 | 485 | 508 | 2 |
| delete | 452 | 482 | 473 | 506 | 2 |
| create | 668 | 722 | 497 | 514 | 2 |
| edit, aliases | 749 | 804 | 508 | 520 | 2 |
| preview, lower bound | 325 | 358 | 341 | 385 | 3 |
| **Save, 4 fields** | **1,761** | 1,791 | **1,752** | 1,781 | 3 |
| **build** | **5,512** | 5,742 | **6,177** | 6,242 | 3 (real progress; the dialog already has it) |
| **seed 10 candidates** | **7,458** | 7,488 | **5,455** | 5,488 | 3 |

The first run of every row is within about 10% of its p50 except the frozen `build` (3.2 s the first time on the small manuscript against 1.1 s after: the first start of a new executable), which is the cold-start effect the PRD warned about and the reason antivirus matters.

## Go-native calls

All are under 10 ms at p50 and under 30 ms at the worst run, so **none needs more than the tier 1 treatment (nothing)**. These were the calls the PRD suspected (`tracksList` re-parsing on every `/media` request, the reader on a full manuscript).

| Operation | p50 (ms) | p95 (ms) | Max (ms) |
| --- | --- | --- | --- |
| manuscript `Chapters`, 88k words | 3 | 7 | 10 |
| manuscript `Search`, a common word (matches every paragraph) | 3 | 8 | 10 |
| manuscript `Reader` (all text) | 2 | 7 | 8 |
| `tracks.Parse`, a 101 KB `.rpp` | under 1 | 4 | 6 |
| settings `Save`, one field | 2 | 4 | 4 |

## What the numbers say

1. **The cost is the floor, not the work.** A one-field edit on a 2,000 word manuscript and on an 88,000 word one differ by 130 ms; the process start and the module import are the other 300 ms. Measured in isolation on this machine (median of 10): the interpreter starts in 47 ms, `import piper.voice` costs 264 ms, `import pronouncing` 97 ms, `import spacy` 668 ms; the dev script's `status --help` (module import only) takes 269 ms and the frozen executable's 342 ms. `manuscript_guide.py` imports `PiperVoice` at module level (line 30) for every subcommand, though only `render-audio` uses it. **In the dev venv about 85% of a cheap operation's time (264 of 310 ms) is a Piper import it does not need.** How the frozen sidecar's 300 ms splits was not measured (PyInstaller's own start is part of it), so phase 4 measures the gain on both.
2. **The frozen sidecar is not slower than the dev venv here**, after its first start. The PRD's worry that PyInstaller startup dominates did not hold on this machine (with Defender off); the risk stays for machines that scan.
3. **One Save is four spawns** (`GuideEdit` runs one process per field, `bindings.go`) and costs 1.2 to 1.8 s; sending the fields in one process would make it about the price of one edit. Seeding ten candidates is ten spawns, 3.7 to 7.5 s, inside an import.
4. **Nothing here needs a fake or padded indicator.** Tier 2 operations need an in-flight state only; tier 3 needs a state that is honest about not knowing the duration (indeterminate), which is what the standard says.

## Proposed tiers (adopted by ADR 0075)

| Tier | Duration | Treatment |
| --- | --- | --- |
| 1 | Under 100 ms | Nothing needed |
| 2 | 100 ms to 1 s | An immediate in-flight state (the control is marked busy and ignores a second press) |
| 3 | 1 to 10 s | The same, plus an indeterminate indicator and a completion signal |
| 4 | Over 10 s | Real progress, cancel or dismiss, and eligibility for an operating system notification |

The acknowledgment is required for every non-instant action whatever the measurement says: the measurement decides only whether a spinner or progress is warranted on top.

## Decision for the audit's phase 4

The data justifies it: cutting the Piper import from every subcommand that does not render audio should remove up to about 260 ms from each operation in the dev-venv tables, and one process per Save removes 3 of its 4 spawns. Both were done in phase 4 (below), with the tables above as the before.

## After phase 4

Measured 2026-09-21 the same way (same harness, machine, 20 runs, synthetic manuscripts; the frozen sidecar was rebuilt from the changed source). Two changes: `manuscript_guide.py` imports Piper only inside `render-audio` (`load_voice`), and `edit` takes several `--field`/`--value` pairs, applies them all in memory and writes the file once, so `GuideEdit` (a Save) starts one process instead of one per field. Seeding a character candidate is one `create` with its description instead of a `create` and an `edit`. p50 in milliseconds, before (the tables above) then after:

| Operation | Dev, small | Dev, full | Frozen, small | Frozen, full |
| --- | --- | --- | --- | --- |
| edit, 1 field | 310 to 121 | 439 to 216 | 313 to 226 | 441 to 355 |
| setLocked | 327 to 129 | 455 to 215 | 318 to 252 | 448 to 362 |
| rescan | 317 to 125 | 469 to 236 | 320 to 231 | 472 to 380 |
| relate | 320 to 125 | 439 to 215 | 320 to 222 | 468 to 355 |
| merge | 294 to 123 | 444 to 209 | 321 to 232 | 485 to 359 |
| delete | 316 to 129 | 452 to 208 | 294 to 249 | 473 to 367 |
| create | 554 to 394 | 668 to 474 | 374 to 348 | 497 to 467 |
| **Save, 4 fields** | **1,247 to 125** | **1,761 to 202** | **1,235 to 245** | **1,752 to 355** |
| Save with the four processes but the lazy import (the old way, measured again) | 538 | 858 | 953 | 1,412 |
| edit, aliases (pronunciation) | 621 to 545 | 749 to 722 | 378 to 342 | 508 to 463 |
| build | 1,433 to 1,439 | 5,512 to 6,416 | 1,095 to 1,237 | 6,177 to 8,114 |

- **A Save is a tier 2 action now** (125 to 355 ms), not a tier 3 one (1.2 to 1.8 s): the lazy import alone took it to 0.5 to 1.4 s, and one process to a fifth of that again. Seeding ten characters that have descriptions is about half the processes (ten instead of twenty); the ten-`create` row is unchanged because a create was not touched.
- **Every mutation is still over 100 ms** (dev 120 to 240 ms, frozen 220 to 380 ms), so the acknowledgment of phase 3 stays required; the change moves work from "a second and a half of nothing" to "a quarter second of a spinner".
- **The frozen floor is about 230 ms** where the dev venv's is about 120 ms: PyInstaller's own start (unpacking, loading the bootloader's Python) is what is left, and the only way under it is a persistent process, which `docs/architecture/codebase-map.md` forbids.
- **Not improved on purpose:** an alias edit still pays for the pronunciation lookup (`pronouncing`, and eSpeak when it is configured); `build` was not touched, and it measured 16% (dev) and 31% (frozen) slower on the second run, which is the size of this machine's run-to-run noise: read every row of the table with about that much slack, which the gains above are far outside of.

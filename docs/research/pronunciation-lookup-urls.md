# Web pronunciation lookup URLs: templates (Phase 0)

**Date:** 2026-09-27. **Stream:** N-B23, [Prep Depth](../prds/prep-depth.prd.md) Phase 2. **Answers:** the four sites' own search-URL shapes (Open Question Q4: exactly Forvo, YouGlish, Merriam-Webster and Howjsay for v1, D71).

**Verdict: unverified; owner check pending.** This session's egress proxy refuses all four domains outright (`EGRESS_BLOCKED`, not a site error), the same gap the owner's D71 comment on [#509](https://github.com/countrymanprime/narration-utils/issues/509) already recorded: this train's sessions cannot reach these sites, so Phase 2 does not block on hand-verification here. The templates below are this session's best-known shape for each site, read from memory rather than the live page, and every one is marked **unverified** until the owner confirms it by hand (a QA item filed on [#510](https://github.com/countrymanprime/narration-utils/issues/510), per the worker protocol).

## What was tried

`WebFetch https://forvo.com/word/croquet/` and `WebFetch https://howjsay.com/how-to-pronounce-croquet` (2026-09-27) both refused with `EGRESS_BLOCKED` before reaching the site - a proxy policy decision, not a 403 or a timeout from the site itself (contrast [the FFmpeg encoder build note](ffmpeg-encoder-build.md), where `pypi.org` was reachable but `gyan.dev` and `github.com` answered `403` from the site). YouGlish and Merriam-Webster were not tried once the pattern was clear; the refusal is a proxy-level domain block, not a per-URL one.

## The four templates

| Source | Template | Escaping | Confidence |
| --- | --- | --- | --- |
| Forvo | `https://forvo.com/word/<word>/` | Path-segment escape (`net/url.PathEscape`) | Medium - Forvo's word pages follow this `/word/<slug>/` shape in this session's training data, but the exact slug rules (case folding, how it treats an apostrophe) are not confirmed live. A word with no Forvo entry 404s; the narrator would need to fall back to Forvo's own site search (`https://forvo.com/search/<word>/`), which this phase does not build - **it opens only the `/word/` page**, per Q4's "a fixed URL template" scope. |
| YouGlish | `https://youglish.com/pronounce/<word>/english` | Path-segment escape | Medium - the `/pronounce/<word>/<language>` shape is YouGlish's own long-standing embed/share URL pattern; not reloaded live this session. |
| Merriam-Webster | `https://www.merriam-webster.com/dictionary/<word>` | Path-segment escape | High - this is Merriam-Webster's dictionary entry URL, the same shape widely linked and cited elsewhere; still unconfirmed against the live site in this session. |
| Howjsay | `https://howjsay.com/how-to-pronounce-<word>` | Spaces become hyphens first (**assumption**, see below), then path-segment escape | Low-Medium - the `how-to-pronounce-<word>` slug shape is remembered, not reloaded; the multi-word case is a guess. |

**Howjsay's multi-word assumption.** Howjsay's slug reads as a hyphenated phrase (`how-to-pronounce-mock-turtle`), not a query string, so `pronunciationlookup.URL` joins the word's fields with `-` before escaping the rest: `"Mock Turtle"` → `how-to-pronounce-Mock-Turtle` (case is left as the narrator typed it; Howjsay's own case-folding is unconfirmed). If the owner's check finds Howjsay actually lower-cases, or uses a different separator, that's a one-line change to `Howjsay`'s branch in `apps/desktop/internal/pronunciationlookup/pronunciationlookup.go` - the fixed test fixtures at `pronunciationlookup_test.go` would need updating too.

## What this session did not verify (owner, pending)

- Opening each of the four templates above in a real browser for a plain word (**croquet**), a two-word name (**Mock Turtle**) and an accented word (**café**), and confirming each lands on a real result page rather than a "not found" or a redirect to the site's own search.
- Howjsay's exact multi-word slug shape (hyphens assumed; case folding unconfirmed).
- Forvo's behavior for a word with no recorded pronunciation (whether `/word/<word>/` 404s cleanly, and whether the search fallback `https://forvo.com/search/<word>/` is worth adding as a second call in a later phase).

Filed as a QA item on [#510](https://github.com/countrymanprime/narration-utils/issues/510).

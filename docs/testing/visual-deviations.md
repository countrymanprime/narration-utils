# Approved deviations from the wireframe

These are changes the user has already explicitly requested that diverge from
`fixtures/narration-console-wireframe.html`. Stage 2 (discrepancy review)
must cross-reference this list before flagging anything below as a parity
bug — these are settled decisions, not oversights.

- Sidebars (chapters/search overlay, detail sidebar) can be dismissed by
  clicking outside them. Not in the wireframe.
- The Note / Story Bible text-selection menu is a single unified popup (like
  a rich-text toolbar), not two separate/overlapping translucent menus.
- Highlight colors (character/place/organization/etc., plus "needs review")
  are configurable in Settings and synced between Story Bible and
  Manuscript. The "Note" color is configured in Manuscript settings
  specifically (not Story Bible), since Note isn't a Story Bible category.
- The Manuscript chapter header ignores the page's horizontal margins and
  sits closer to the left/right edges than the rest of the content.
- Manuscript chapters are collapsible, with auto-collapse/auto-expand as the
  reader scrolls, and a page-level setting to toggle that auto-focus
  behavior on/off (falling back to manual collapse/expand + "collapse all" /
  "expand all" controls). The last chapter/scroll position is remembered so
  returning to Manuscript restores it.
- Chapters and lines (and Notes specifically, not other annotation types)
  can be bookmarked, breakpoint-style: toggled from the left margin, shown
  as a sideways bookmark icon under the line number. Chapter bookmarks sit
  to the left of the chapter header (word count / read time stay
  right-aligned), dimmed-outline until hover/active, full color on
  hover/active, with a z-index that keeps the line number legible on top.
  Bookmarked chapters/lines/notes are threaded into a nested list under
  their chapter in the chapters/search sidebar.
  - **2026-09-13 refinement, implemented**: the chapter bookmark's hover/
    active state triggers only when hovering the icon itself (`.chapter-
    bookmark:hover`), not anywhere in the chapter header row. Its column
    was also narrowed (2rem → 1.4rem) so it sits the same distance from
    the left edge as the chapter-meta text does from the right edge.
  - **2026-09-13 refinement, implemented**: the line-level bookmark icon
    is invisible at rest for every line regardless of bookmarked state
    (matching the "shouldn't exist until hover/active" chapter-bookmark
    rule, and how editor gutters like VS Code's breakpoints work), and
    shows in blue (`--bookmark` token) only on `.ms-gutter:hover` — a
    bookmarked line reveals more opaque than an unbookmarked one on hover,
    but neither is visible at rest. Rotated 270° total (90° original + the
    requested 180° flip). Needed `!important` on its font-size — see the
    comment at its CSS rule for why (a Tailwind base reset otherwise wins
    the cascade on `<button>` elements).
  - **2026-09-13, second fix**: the first attempt above was silently
    overridden by a duplicate, older `.gutter-bookmark` rule inside a
    "Second parity pass" comment block later in styles.css (same
    specificity, later source order wins) — it set opacity:1/color:accent
    unconditionally, which is why the icon kept showing non-blue and
    always-visible after the first fix. Removed the duplicate declaration.
    **Flagged for a cleanup pass, not done yet**: that same block also
    duplicates `.reader-chapter` (with `overflow:hidden`, conflicting with
    the `overflow:visible` needed for the header-pinning fix) and
    `.reader-chapter-header` (different padding) — not touched since
    current behavior tests fine, but the stylesheet has two competing
    definitions of the same selectors and should be reconciled.
- The Manuscript reader header is sticky; chapters scroll underneath it.
  - **2026-09-13, resolved**: CSS `position: sticky` doesn't work reliably
    here — a nonzero `top` value on `.reader-chapter-header` painted it
    shifted down by that amount even at rest (not just once actually
    stuck, as spec'd), landing on top of its own paragraph text; `top: 0`
    avoided that but then just disappeared behind the also-sticky control
    band while scrolling instead of pinning visibly below it. Root cause
    not fully identified despite real effort (ruled out: `var()` vs literal
    px values, the control band's own sticky, jsdom/preview-tool
    quirks — reproduced identically under real Playwright/Chromium).
    Replaced with JS-driven positioning instead: a scroll listener measures
    the active chapter's card position and switches its header to
    `position: fixed` (with a matching placeholder to prevent a layout
    jump) once the card has scrolled under the band, clearing it back to
    normal flow once the chapter has fully scrolled past. Sidesteps the
    native sticky bug entirely.
- **2026-09-13**: chapter auto-focus switches by scroll *intersection*
  (an `IntersectionObserver` watching a fixed trigger line just below the
  control band, scrollspy-style), not by scroll distance/direction — the
  old approach could never advance past a chapter when the remaining
  collapsed chapters didn't add up to a full viewport of scrollable
  height, since there was nowhere left to scroll to reach the next
  chapter's threshold.
  - **2026-09-13, found during testing**: a scrollTop-based fallback for
    that same short-page case turned out to be insufficient - once the
    *active* chapter collapses the whole page down to fit inside the
    viewport with zero overflow (e.g. after switching to a short chapter),
    there is nothing left to scroll in *either* direction, so no `scroll`
    event ever fires again and navigation dead-ends completely (confirmed:
    "once i go to chapter 2, i can't go back or forward"). Replaced with a
    `wheel`-event listener instead, which fires on every scroll gesture
    regardless of whether the container can actually move: a downward
    gesture while already at the scroll bottom advances to the next
    chapter, an upward one while at the scroll top goes back. Verified via
    real scroll gestures through all 4 chapters forward and back.
- **2026-09-13**: the reading-width preset selector (narrow/comfortable/
  wide/full) is replaced with a single fixed full-width reading column plus
  a text-size control instead — avoids the reading column's margins
  shifting between widths. (Raised after the width presets were found to
  interact badly with the sticky chapter header — see the parity review
  artifact for the reproduction. Fixing that rendering bug is still
  required regardless of this change, since the same sticky-header/
  auto-focus mechanism is used at any width.)
- Shorter-width annotations layer on top of longer ones so the correct one
  opens when they overlap.
- Proofing's "last narrated take" is a clickable link to that run's results.
  Returning to Proofing after leaving always starts over at step 1 (setup).
- Settings' per-field override control is labeled "Reset" (not "Clear
  override") and sits to the right of the field's selection control; when
  reset, the field must visually show the actual color/value it falls back
  to, not a blank/placeholder swatch.
- The Settings header and category navigation are static (fixed); only the
  right-hand settings panel scrolls underneath them.

## Known wireframe-only display issues (do not replicate)

- The wireframe file has no `<meta charset="utf-8">` (and no `<!doctype>`/
  `<html>`/`<head>` wrapper at all), so opening it via `file://` mojibakes
  its em dashes, ellipses, and middot separators. The copy in
  `fixtures/narration-console-wireframe.html` has one `<meta charset="utf-8">`
  line added at the very top (content otherwise byte-for-byte identical) so
  screenshots render the real text — this is an infra fix, not a content
  change, and the app should of course just use UTF-8 correctly, which it
  already does.
- The wireframe mixes two different tooltip mechanisms: a unified
  `data-tooltip` + `#tooltip-layer` system, and an older inline
  `.tip-wrap`/`.tip-icon`/`.tip-bubble` pattern used in a few places (e.g.
  the Home timing panel, several Settings field labels). The app should use
  one unified tooltip system everywhere (already true today) — a screenshot
  showing the wireframe's older inline pattern is not something to copy.

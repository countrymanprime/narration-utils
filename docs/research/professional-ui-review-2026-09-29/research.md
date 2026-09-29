# Professional interface design applied to Narration Utils

Research begun 28 September; current UI captures and proposals completed 29 September 2026.

**Recommendation:** keep the benchmark's visual identity and extend its workspace patterns across the application. Improve the benchmark where it implies unavailable capabilities, hides state, uses overly faint text, or leaves interaction rules unspecified. This is an evidence-informed design evaluation, not a user-tested claim that one style is objectively best.

[Open the comparison gallery](index.html). [Read capture provenance and verification](README.md).

## 1. What the external research establishes

The research preceded evaluation of the current screenshots. The most relevant comparators are professional creative and information-dense applications, rather than marketing sites. An audiobook workspace needs sustained reading, precise navigation, repeated review decisions, and honest connections to files and audio systems.

### Quiet structure, clear hierarchy

Linear's March 2026 refresh deliberately reduces the prominence of supporting navigation and standardizes headers and action locations. It also softens unnecessary separators. The relevant lesson is consistency across a growing product, not copying its brand or stripping useful density. [Linear, *A calmer interface for a product in motion*](https://linear.app/now/behind-the-latest-design-refresh).

Adobe Spectrum uses theme-specific semantic colors and background layers to preserve meaning and separation across themes. This supports designing dark mode as a coherent set of surfaces and contrasts. [Spectrum, *Using color*](https://spectrum.adobe.com/page/using-color/).

Atlassian describes a limited spacing scale based on an 8-pixel unit, including smaller steps for compact controls. Its typography guidance treats font size, line height and paragraph spacing as a system; its standard body styles include 14/20 and 16/24. These are examples of disciplined systems, not universal mandatory dimensions. [Atlassian spacing](https://atlassian.design/foundations/spacing), [typography](https://atlassian.design/foundations/typography).

**Application — design judgment:** retain warm neutral surfaces, copper emphasis, Barlow Condensed headings and IBM Plex body text. Use contrast, position and spacing to establish importance. Reserve mono for timestamps, measurements and paths. Avoid making all body copy, labels or buttons small uppercase text. Give one principal task the strongest action treatment in each local context.

### Density should support a task

Carbon places global table controls in a toolbar and changes the action context when rows are selected. It advises giving tables room, keeping toolbars concise, and moving extensive supplementary information into a more suitable surface. [Carbon Data Table](https://carbondesignsystem.com/components/data-table/usage/).

Fluent distinguishes inline drawers, which support work alongside the main content, from overlay drawers, which interrupt that context. More complex work deserves adequate space rather than accumulating layers. [Fluent Drawer](https://fluent2.microsoft.design/components/web/react/core/drawer/usage).

**Application — design judgment:** the benchmark's chapter table, reading column and evidence rail are appropriate. Preserve them. Use a stable selected-item inspector for Proof and series references; place metadata below the evidence and decision. At narrow widths, give detail its own usable area and explicit return path instead of squeezing three columns into unreadability.

### Repeated review should preserve context

Linear's Peek supports inspecting an item without leaving the list, moving between adjacent items, and closing the preview. Its Triage separates incoming items from accepted work through explicit review decisions. These are useful interaction precedents, not evidence that their exact shortcuts suit audio work. [Linear Peek](https://linear.app/docs/peek), [Linear Triage](https://linear.app/docs/triage).

**Application — design judgment:** retain filters and list position while opening, deciding and advancing between findings. Separate detection, review decision and exported DAW marker. Add overview previous/next and immediate Undo only as explicit product changes. Do not copy Space-for-preview into an audio tool; respect the existing reading/playback command scopes and suppress shortcuts while typing.

### Empty, busy, failed and completed are different states

Carbon distinguishes first use, no search results, successful emptiness and errors; the explanation belongs where the missing content would otherwise appear. [Carbon Empty States](https://carbondesignsystem.com/patterns/empty-states-pattern/).

Fluent's progress guidance favors measurable work when available and useful explanations on failure. Carbon separately describes inactive, active, finished and error loading states. [Fluent Progress Bar](https://fluent2.microsoft.design/components/web/react/core/progressbar/usage), [Carbon Inline Loading](https://carbondesignsystem.com/components/inline-loading/usage/).

Atlassian matches messages to scope: system-level banners, local section messages, and event acknowledgments serve different purposes. GOV.UK's validation pattern connects errors with their inputs and correction paths. [Atlassian Designing Messages](https://atlassian.design/foundations/content/designing-messages), [GOV.UK validation](https://design-system.service.gov.uk/patterns/validation/).

**Application — design judgment:** “no manuscript,” “no matching notes,” “all notes reviewed,” and “audio unavailable” must look and read differently. Report real work units and named stages; keep an unknown duration unknown. Put a failed save near the save context. Retain the file selection, review note and completed work after a recoverable failure. The current app already does much of this; the job is consistent presentation.

### Confidence comes from control and accessibility

Carbon's community removal pattern varies confirmation by impact and reversibility. It is community guidance, not a universal policy. [Carbon Remove pattern](https://carbondesignsystem.com/community/patterns/remove-pattern/).

W3C explains that an interactive grid requires managed focus and directional navigation; declaring a grid role does not implement those behaviors. Status changes should be exposed without unnecessarily moving focus. [W3C Grid pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/), [Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).

WCAG 2.2's minimum target-size criterion specifies 24 × 24 CSS pixels or applicable exceptions, including spacing. Focus must not be entirely obscured by authored content. Modal dialogs also require appropriate contained focus and a logical return path. [Target Size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum), [Focus Not Obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum), [Modal Dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).

**Application — design judgment:** use ordinary table semantics unless spreadsheet-style navigation is required. Make routine controls comfortably larger than the minimum where practical. Distinguish keyboard focus, current row, multi-selection and status color. Preserve Reopen; immediate Undo is an optional acceleration. Confirm consequential manuscript replacement with exact consequences, without adding confirmation to every reversible review decision.

## 2. How this relates to the seven benchmark mocks

The authoritative mapping is in `apps/ui/tests/visual/mock-match/mocks.ts`. These are the post-redesign Production / Script / Booth / Proof / Master / Series / Companion concepts, not the former Home / Manuscript / Teleprompter workflow.

| Benchmark | Keep | Enhance | Current implementation distinction |
| --- | --- | --- | --- |
| 01 Production | One KPI strip, chapter pipeline, next-up rail, restrained status palette | Primary action hierarchy; readable status/evidence explanations; secondary placement for manuscript replacement | Already closely follows the composition. Real measured/logged facts must take priority over invented concept figures and forecast assumptions. |
| 02 Prep / Script | Chapter navigation, central manuscript, supporting pronunciation/character/query rail | Keep the selected chapter text visible near the top; contextual annotations; usable rail controls | All three regions exist. In the captured state, repeated collapsed cards consume the upper half of the reader. A focused chapter mode is proposed, not permission to remove manual/continuous reading. |
| 03 Booth | Large text, speaker cues, contextual side rail, steady transport, optional dark environment | Improve dim-text contrast; distinguish ready/following/recording; hide ordinary app chrome in an explicit focus mode | Current Booth has the full app rail and header. The scene rail says reference clips are coming soon. A mock showing playable clips is a capability proposal. |
| 04 Proof | Notes beside selected evidence and recording context | Script/Heard first; stable decision area; collapsible secondary evidence; fast adjacent review | Inspector, audition, decisions and Reopen already exist. The initial detail capture pushes resolution controls below the viewport. Overview previous/next, Undo toast and overview waveform are new proposals. |
| 05 Master / delivery | Measured-file table, failed-file explanation, readiness rail | Explicit units, stale/unmeasured/manual states; explanations adjacent to disabled actions | Current fixtures expose silence, unsupported files and manual checks. Do not replace those honest states with fabricated pass marks. Mock measurements are illustrative, not compliance advice. |
| 06 Series voices | Character list, reference clips, notes and contextual evidence | Approval/stale-reference visibility, readable evidence ranges, one selected-character workspace | Current Series tab is nested cards plus book folders. It already flags changed references. The fuller candidate-comparison layout needs capability and data-contract verification. |
| 07 Companion | Narrow contextual tool beside the DAW | Focus/readiness clarity, local decisions, compact controls | Compare only the 420 × 900 companion area. The benchmark's DAW is an illustration. Global hotkeys forwarded from REAPER are not implemented. |

The benchmark is strongest as an information architecture and visual language. It is incomplete as an interaction specification. A green badge, waveform or “approved” label must have a real source and a defined transition; matching the picture cannot justify inventing runtime state.

## 3. Extending the system beyond those frames

| Surface | Visual rule | Interaction contract | Existing versus proposed |
| --- | --- | --- | --- |
| Settings | Bounded form width, stable label/control alignment, shared panel headers, quiet help | Explicit global/project scope, inherited versus overridden values, dirty footer, guarded departure | All those behaviors exist. Proposed mock demonstrates clearer hierarchy; its reader fields are illustrative rather than an exact settings schema. |
| Import review | Outline beside selected-section preview; steady footer | Review classification, subtitles and individual character suggestions; preserve source; explain replacement separately | Existing review contract must remain. Split preview is proposed. The new frame shows the outline step, not every classification/character control. |
| Pickups | Queue + selected line + recording readiness | Keep original context available, capability-gate punch, mark done, retain CSV row errors | Sequential controls already exist. The selectable/session-planning queue is new functionality. |
| Project picker | Shared type/row treatment without the full app shell | Recent/open/create/browse; secondary remove-from-recents; visible errors | Existing capabilities; refine hierarchy. A dedicated retry for a failed recents load is a potential small addition. |
| Filters / no results | Local, concise message in the results area | Keep filter values; provide Clear filters; retain existing decisions | Already implemented in Proof. New study standardizes the treatment. |
| Long tasks | Consistent progress/body/footer structure | Host-reported stage and units; background/cancel only when supported; preserve work | Existing WorkDialog and app job handling already provide these foundations. |
| Failure / stale evidence | Local message near the affected task, with one recovery action | Retain typed note/input; reject stale decisions; allow retry or selection repair | Stale decision protection already exists and is captured. |
| Destructive/reset confirmation | Specific title and affected resource; restrained danger treatment | Explain what is lost; visible Cancel; contained focus; restore focus afterward | Existing alert-dialog patterns should be kept, then checked consistently. |
| Keyboard / pedals | Visible shortcut hints and a coherent help sheet | Scope commands; report conflicts; do not capture text-entry keys; distinguish focused-window and global input | Configurable bindings, conflict handling and help already exist. Do not present them as missing. |
| Tablet / zoom | Prioritize reading and evidence; switch layout intentionally | Preserve selection when regions collapse; keep focus and controls reachable | Actual tablet captures included. Prototype layout checks are preliminary, not full responsive acceptance. |

## 4. Proposed design-system contract

These are suggested implementation targets inferred from the research and benchmark, not source-prescribed requirements:

- **Structure:** keep the benchmark's 216px rail and 52px header as the desktop baseline; keep page actions in a predictable title/view-toolbar region. Focus mode is an explicit mode, not a surprise navigation change.
- **Type:** approximately 28–30px page headings, 18–20px panel headings, 14px ordinary body/control text, 12px secondary copy, and 16–18px manuscript prep text with generous leading. Booth text remains separately adjustable. Do not use 10–11px condensed uppercase text for substantial instructions.
- **Spacing:** use a finite 4/8/12/16/24/32 scale. Related controls have less separation than distinct sections. Avoid giant blank form cards merely because the window is wide.
- **Color:** one copper action/selection accent; neutral surfaces; semantic green/amber/red/blue paired with words or icons. Test every token in both themes. The new prototypes have not undergone a complete WCAG contrast audit.
- **Controls:** consistent heights and radii, visible hover/focus/disabled states, text for consequential actions, and accessible names for icon buttons. Real implementation should use the existing icon library; the prototypes use simplified symbols.
- **Motion:** short state transitions that explain change; no decorative movement during recording; honor reduced-motion settings. Suggested 120–180ms feedback is a design choice, not a benchmark requirement.
- **Persistence:** preserve list position, filters, selected chapter, typed notes and unsaved preferences across appropriate navigation/recovery. Surface the source and age of evidence before decisions depend on it.
- **Completion:** design first-use, loading, partial, empty, error, cancelled, stale and successful states alongside the populated frame. A component is not complete at its default screenshot.

## 5. Sequence worth implementing

1. **Low-risk consistency pass:** shared heading/toolbars, form widths, action ordering, readable helper text and one message hierarchy. Preserve existing behavior and verify the actual visual matrix.
2. **Script and Proof ergonomics:** explicit selected-chapter presentation; compress repeated Proof metadata so evidence and decisions fit; preserve full details behind an accessible disclosure. Compare time and scrolling required to review the same fixture.
3. **Series and Pickups workspace changes:** write separate behavior/data requirements for references, selection, queue planning, approval, staleness and recording handoff. These changes are larger than styling.
4. **Focused Booth and companion:** validate with narrators using actual microphones, REAPER focus changes, shortcuts and devices. Browser fixture screenshots cannot validate audio or native window behavior.

For evaluation, ask narrators to resume a chapter, review three findings, recover a stale decision, resolve a missing audio file, change a project override, and start a pickup. Measure task completion, mistaken actions, loss of context and perceived effort. Do not treat pixel similarity or aesthetic preference alone as proof of usability.

## Method and limitations

The invoked `ecc:deep-research` workflow was used with the available web tools because Firecrawl/Exa were unavailable. Research used primary product documentation and design-system guidance across visual hierarchy, dense workspaces, repeated review, state/recovery design and accessibility. Linear's 2026 refresh provides a dated recent example; living design-system pages were checked during this work but may not state a recent publication date. Older durable standards were not presented as newly published trends.

Research was followed by current-source inventory, the full actual UI visual suite, seven theme/viewport-matched benchmark tests, direct inspection of fresh screenshots, and new coded prototypes. The comparison is a design critique, not a controlled usability study or a full accessibility audit. Prototype-only features and changes in sample data are labeled per screen. No production UI files were changed.

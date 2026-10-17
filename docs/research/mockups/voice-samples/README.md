# Voice samples: mock

**Status:** approved by the owner on 2026-10-17 ("mocks look good"). Added 2026-10-17 for [the PRD](../../../prds/character-voice-samples.prd.md) ([#1820](https://github.com/countrymanprime/narration-utils/issues/1820)). The Studio Next mock does not cover this feature, and [ADR 0760](../../../adr/0760-the-studio-next-mock-is-the-only-spec-for-every-page-it-covers-tokens-primitive-sizes-and-layouts-included.md) builds nothing a mock lacks. The owner has approved this one, so phases 3 to 5 of the PRD build to it.

One static file, `index.html`: no build, no network, system fonts. Open it in a browser. It takes the Studio Next mock's tokens from `docs/research/mockups/studio-next/src/styles/app.css`, follows the system theme, and has a Light and Dark switch (`?theme=dark` also works). Sample data is invented, and the play buttons only toggle their own state.

## Frames

| Page | Frames |
| --- | --- |
| Editing | Words selected with the **Voice sample** toolbar action; the **Voice sample** dialog ready to save; the dialog refused (words across two takes); the saved toast |
| Story Bible | A character entry with four samples (primary, playing, **Passage changed**, **Audio file missing**) above **Reference clips**; the empty section; the **Voice data** panel with Narration's sample, the totals and a sample whose character left the Story Bible |
| Booth | The speaker picker with a play control on each character that has a sample; **Voices in this scene** with the samples listed; play refused while a take records; the listening-paused state |

## Lifecycle

This folder is deleted in the pull request that merges the last of phases 3 to 5, as the Studio Next mock's rule says ([Which mocks are the spec](../../../prds/studio-next-rebuild.prd.md#which-mocks-are-the-spec)). Nothing links to it from outside this PRD.

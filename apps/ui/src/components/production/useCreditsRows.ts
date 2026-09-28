import { useEffect, useState } from 'react';
import type { ChapterStatus, CreditTemplate, NarrationApi } from '../../types';
import { estimateCreditsSeconds, roomToneSeconds } from '../../state';

// The one template of a kind (ADR 0093): the first in the library.
const firstOfKind = (templates: CreditTemplate[], kind: string) => templates.find((template) => template.kind === kind);

// The room tone setting (General > "Room tone per credits file", audiobook-credits-templates.prd.md Phase 5): a secondary
// read, 0 when it cannot be read.
async function readRoomTone(api: NarrationApi): Promise<number> {
  try {
    const settings = await api.settingsForScope('global');
    return roomToneSeconds(settings.General?.find((field) => field.key === 'credits_room_tone_seconds')?.effectiveValue);
  } catch {
    return 0;
  }
}

export type CreditsKind = 'opening' | 'closing';

export type CreditsRow = {
  kind: CreditsKind;
  template?: CreditTemplate;
  words?: number;
  estimatedSeconds?: number;
  unresolved: string[];
  status: ChapterStatus;
};

/**
 * The Production board's Opening/Closing credits rows (credits-in-chapter-table.prd.md Phase 2, moved from Home by
 * stage-navigation-and-page-replacement.prd.md Phase 2). Reads the first template of each kind (ADR 0093), each rendered
 * with its own room tone (CT9) and status from the project manifest (CT2, CT3). `template` is undefined when the library
 * has none of that kind (CT5: the row still renders, as "Not set up"). Undefined while loading or on any failure: a
 * credits problem leaves the rows out rather than toasting.
 *
 * `setStatus` calls the host's `setCreditsStatus` (never `manuscriptSetChapterStatus`, and it never touches stage
 * suggestions - credits are not assessed by the stage engine) and updates the row in place on success.
 */
export function useCreditsRows(
  api: NarrationApi,
  refreshKey: string | undefined,
  onError: (error: unknown) => void,
): { rows?: Record<CreditsKind, CreditsRow>; setStatus: (kind: CreditsKind, status: ChapterStatus) => Promise<void> } {
  const [rows, setRows] = useState<Record<CreditsKind, CreditsRow>>();
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [templates, statuses, roomTone] = await Promise.all([api.creditsTemplates(), api.creditsStatuses(), readRoomTone(api)]);
        const build = async (kind: CreditsKind): Promise<CreditsRow> => {
          const status = (statuses[kind] as ChapterStatus | undefined) ?? 'not_started';
          const template = firstOfKind(templates, kind);
          if (!template) return { kind, unresolved: [], status };
          const preview = await api.creditsPreview(template.body);
          return {
            kind,
            template,
            words: preview.words,
            estimatedSeconds: estimateCreditsSeconds([preview.words], roomTone),
            unresolved: preview.unresolved,
            status,
          };
        };
        const [opening, closing] = await Promise.all([build('opening'), build('closing')]);
        if (active) setRows({ opening, closing });
      } catch {
        if (active) setRows(undefined);
      }
    })();
    return () => {
      active = false;
    };
  }, [api, refreshKey]);
  const setStatus = async (kind: CreditsKind, status: ChapterStatus) => {
    try {
      await api.setCreditsStatus(kind, status);
      setRows((current) => (current ? { ...current, [kind]: { ...current[kind], status } } : current));
    } catch (error) {
      onError(error);
    }
  };
  return { rows, setStatus };
}

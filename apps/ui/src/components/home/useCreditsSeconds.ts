import { useEffect, useState } from 'react';
import type { CreditTemplate, NarrationApi } from '../../types';
import { estimateAnnouncementSeconds, estimateCreditsSeconds, roomToneSeconds } from '../../state';

const firstOfKind = (templates: CreditTemplate[], kind: string) => templates.find((template) => template.kind === kind);

// The room tone setting (General > "Room tone per credits file", Phase 5): a secondary read, 0 when it cannot be read.
async function readRoomTone(api: NarrationApi): Promise<number> {
  try {
    const settings = await api.settingsForScope('global');
    return roomToneSeconds(settings.General?.find((field) => field.key === 'credits_room_tone_seconds')?.effectiveValue);
  } catch {
    return 0;
  }
}

/**
 * The Home estimate's Credits stat in seconds (audiobook-credits-templates.prd.md, Phases 2 and 5): the first opening
 * and first closing template (ADR 0093), each a file of its own with the narrator's room tone added, plus the first
 * chapter announcement template rendered for every narration chapter, with no room tone of its own (ADR 0151).
 * Undefined while loading, when the library has none of these, or when a credits call fails: the stat is secondary, so a
 * credits problem leaves it out rather than blanking the estimate or toasting. A retail sample is never counted (C10).
 */
export function useCreditsSeconds(api: NarrationApi, refreshKey?: string): number | undefined {
  const [seconds, setSeconds] = useState<number>();
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const templates = await api.creditsTemplates();
        const files = (['opening', 'closing'] as const)
          .map((kind) => firstOfKind(templates, kind))
          .filter((template): template is CreditTemplate => template !== undefined);
        const announcement = firstOfKind(templates, 'chapter_announcement');
        if (files.length === 0 && !announcement) {
          if (active) setSeconds(undefined);
          return;
        }
        const [rendered, announcements, roomTone] = await Promise.all([
          Promise.all(files.map((template) => api.creditsPreview(template.body))),
          announcement ? api.creditsChapterAnnouncements(announcement.body) : Promise.resolve([]),
          readRoomTone(api),
        ]);
        const total =
          estimateCreditsSeconds(
            rendered.map((result) => result.words),
            roomTone,
          ) + estimateAnnouncementSeconds(announcements.map((item) => item.result.words));
        if (active) setSeconds(total);
      } catch {
        if (active) setSeconds(undefined);
      }
    })();
    return () => {
      active = false;
    };
  }, [api, refreshKey]);
  return seconds;
}

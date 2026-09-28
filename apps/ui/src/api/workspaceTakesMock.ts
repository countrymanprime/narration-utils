// The browser mock's Takes panel (edit-and-proof-workspace.prd.md Phase 6, ADR 0700), answering the way
// apps/desktop/bindings_workspace_takes.go and internal/passagetakes do: the passage snaps out to whole paragraphs, the
// item it was heard on has other takes, its line has another retake on a fixed lane, and a take-review group set a
// read from another item beside it (one candidate from each of EP6's sources, in the shape
// tests/fixtures/contracts/workspace-takes.json pins). Choosing a take moves what plays, in the mock's memory, and the
// REAPER refusals use the host's own words. Nothing here ranks the takes (take review Q9).
import type {
  Finding,
  ManuscriptParagraph,
  PassageTake,
  TakeComparisonJob,
  UseTakeRefusal,
  WorkspaceAlignmentResult,
  WorkspaceApi,
  WorkspaceItem,
  WorkspaceTakesResult,
  WorkspaceToken,
  WorkspaceUseTakeResult,
} from '../types';
import type { MockReaper } from './findingsMock';
import { takeComparisonEvidenceSchema } from './schemas/takeReview';
import { mockPassageComparison, type MockPassageRead } from './takeComparisonMock';

type Deps = {
  alignment: (chapterId: string) => Promise<WorkspaceAlignmentResult>;
  paragraphs: () => ManuscriptParagraph[];
  chapterTitle: (chapterId: string) => string;
  /** The saved comparison of a passage, by finding id, or undefined while none was made. */
  comparison: (findingId: string) => Promise<Finding | undefined>;
  beginPassageComparison: (passageId: string, comparison: Finding, reads: number) => TakeComparisonJob;
  reaper?: MockReaper;
};

// The host's words for what choosing a take did (apps/desktop/internal/passagetakes/use.go); workspaceTakesMock.test.ts
// checks the stale one against the committed golden.
export const USE_TAKE_MESSAGES = {
  notOffered: "That take isn't one of this passage's takes any more, so nothing was changed. The list has been read again.",
  stale: "This take's item is no longer in the REAPER project, so nothing was changed. Run the check again to find the takes where they are now.",
  recording: 'REAPER is recording, so nothing was changed. Stop recording first.',
  scriptOutdated: "The Narration Utils script in REAPER is older than this app. Import it again from this app's REAPER folder, then try again.",
  standalone: 'REAPER is not connected to this app. To choose a take, open this app from the Narration Utils action in REAPER.',
  notRunning: 'REAPER is not answering. Check that REAPER is open and the Narration Utils action is running, then try again.',
  alreadyPlaying: 'That take is already the one playing, so nothing changed.',
  madeActive:
    'Made that take active in REAPER, in one undo step: Undo in REAPER puts the previous take back. Save the project in REAPER to bring the check up to date.',
  addedAndMadeActive: 'Added the read as a new take and made it active in REAPER (two undo steps). Save the project in REAPER to bring the check up to date.',
  pickingLane: 'Asking REAPER to play this retake…',
  notHeard: "This passage wasn't heard in the recording, so there are no takes to set beside it. Run the check again if the chapter has changed.",
  itemGone: 'The item this passage was heard on is no longer in the saved REAPER project. Save the project in REAPER and run the check again.',
} as const;

const MOCK_TAKE_TWO = '{MOCK-TAKE-0002-0000-0000-000000000002}';
const MOCK_LANE_ITEM = '{MOCK-ITEM-0002-0000-0000-000000000002}';
const MOCK_LANE_TAKE = '{MOCK-TAKE-0003-0000-0000-000000000003}';
const MOCK_READ_ITEM = '{MOCK-ITEM-0004-0000-0000-000000000004}';
const MOCK_READ_TAKE = '{MOCK-TAKE-0005-0000-0000-000000000005}';

const refused = (reason: UseTakeRefusal, message: string): WorkspaceUseTakeResult => ({ outcome: 'refused', reason, message, changed: false });

/** The item most of a range's heard tokens sit on (the lowest index when they tie), or undefined when none were heard. */
function majorityItem(tokens: WorkspaceToken[]): number | undefined {
  const counts = new Map<number, number>();
  for (const token of tokens) if (token.item !== undefined) counts.set(token.item, (counts.get(token.item) ?? 0) + 1);
  let best: number | undefined;
  for (const [item, count] of counts) if (best === undefined || count > counts.get(best)! || (count === counts.get(best) && item < best)) best = item;
  return best;
}

export function createWorkspaceTakesMock(deps: Deps): Pick<WorkspaceApi, 'workspaceTakes' | 'workspaceTakesCompareStart' | 'workspaceUseTake'> {
  const mode = deps.reaper ?? 'connected';
  /** What plays now, by passage: a candidate id. Absent means the item's own first take. */
  const playing = new Map<string, string>();

  type Resolved = { view: WorkspaceTakesResult; item?: WorkspaceItem; spanText: string };

  const resolve = async (chapterId: string, firstToken: number, lastToken: number): Promise<Resolved> => {
    const alignment = await deps.alignment(chapterId);
    if (firstToken < 0 || lastToken >= alignment.tokens.length || firstToken > lastToken) {
      throw new Error(`tokens ${firstToken} to ${lastToken} are not in this chapter's alignment; reload the workspace`);
    }
    const inRange = alignment.tokens.slice(firstToken, lastToken + 1);
    const paragraphIndexes = inRange.map((token) => alignment.paragraphs.findIndex((paragraph) => paragraph.id === token.p)).filter((index) => index >= 0);
    const firstParagraph = Math.max(paragraphIndexes.length ? Math.min(...paragraphIndexes) : 0, 0);
    const lastParagraph = Math.max(paragraphIndexes.length ? Math.max(...paragraphIndexes) : 0, 0);
    const base: WorkspaceTakesResult = {
      chapterId,
      firstToken,
      lastToken,
      firstParagraph,
      lastParagraph,
      words: lastToken - firstToken + 1,
      passageId: '',
      itemGuid: '',
      candidates: [],
    };
    const spanText = alignment.paragraphs
      .slice(firstParagraph, lastParagraph + 1)
      .map((paragraph) => paragraph.text)
      .join(' ');
    const itemIndex = majorityItem(inRange);
    if (itemIndex === undefined) return { view: { ...base, message: USE_TAKE_MESSAGES.notHeard }, spanText };
    const item = alignment.items.find((candidate) => candidate.index === itemIndex);
    if (!item || !item.live) return { view: { ...base, message: USE_TAKE_MESSAGES.itemGone }, spanText };

    const passageId = `passage-${chapterId}-${firstParagraph}-${lastParagraph}`;
    const length = (item.length ?? 0) * (item.playRate ?? 1);
    const start = item.sourceStart ?? 0;
    const active = playing.get(passageId) ?? `take:${item.itemGuid}:${item.takeGuid ?? ''}`;
    const candidate = (take: Omit<PassageTake, 'active' | 'usable' | 'compared'>): PassageTake => ({
      ...take,
      active: take.id === active,
      usable: true,
      compared: false,
    });
    const candidates: PassageTake[] = [
      candidate({
        id: `take:${item.itemGuid}:${item.takeGuid ?? ''}`,
        source: 'item_take',
        action: 'make_active',
        confirm: false,
        label: 'Take 1',
        detail: 'Take 1 of 2 on this item · chapter-1.wav',
        itemGuid: item.itemGuid,
        takeGuid: item.takeGuid ?? '',
        sourceFile: 'chapter-1.wav',
        sourceStart: start,
        sourceLength: length,
      }),
      candidate({
        id: `take:${item.itemGuid}:${MOCK_TAKE_TWO}`,
        source: 'item_take',
        action: 'make_active',
        confirm: false,
        label: 'Take 2',
        detail: 'Take 2 of 2 on this item · chapter-1-second.wav',
        itemGuid: item.itemGuid,
        takeGuid: MOCK_TAKE_TWO,
        sourceFile: 'chapter-1-second.wav',
        sourceStart: start,
        sourceLength: length,
      }),
      candidate({
        id: `lane:line-000004:${MOCK_LANE_ITEM}`,
        source: 'lane_retake',
        action: 'pick_lane',
        confirm: false,
        label: 'Retake on lane 2',
        detail: 'retake 2 · lane 2 of Chapter One · chapter-1-retake.wav',
        itemGuid: MOCK_LANE_ITEM,
        takeGuid: MOCK_LANE_TAKE,
        sourceFile: 'chapter-1-retake.wav',
        sourceStart: 0,
        sourceLength: length,
      }),
      candidate({
        id: 'read:g-1:1',
        source: 'take_review',
        action: 'add_and_activate',
        confirm: true,
        label: 'Read from another item',
        detail: 'pickup.wav · found by Find pickups and duplicates (pickup)',
        itemGuid: MOCK_READ_ITEM,
        takeGuid: MOCK_READ_TAKE,
        sourceFile: 'pickup.wav',
        sourceStart: 3,
        sourceLength: Math.min(length, 8),
      }),
    ];
    return { view: { ...base, passageId, itemGuid: item.itemGuid, candidates }, item, spanText };
  };

  const withComparison = async (resolved: Resolved): Promise<WorkspaceTakesResult> => {
    const { view } = resolved;
    if (!view.passageId) return view;
    const saved = await deps.comparison(`c-${view.passageId}`);
    if (!saved) return view;
    const parsed = takeComparisonEvidenceSchema.safeParse(saved.evidence);
    if (!parsed.success) return view;
    const { members } = parsed.data;
    return {
      ...view,
      comparisonId: saved.id,
      candidates: view.candidates.map((candidate) => {
        const member = members.find((entry) => entry.item_guid === candidate.itemGuid && entry.take_guid === candidate.takeGuid);
        return member?.compared ? { ...candidate, compared: true, fidelity: member.fidelity ?? undefined } : candidate;
      }),
    };
  };

  return {
    workspaceTakes: async (chapterId, firstToken, lastToken) => withComparison(await resolve(chapterId, firstToken, lastToken)),
    workspaceTakesCompareStart: async (chapterId, firstToken, lastToken) => {
      const resolved = await resolve(chapterId, firstToken, lastToken);
      if (!resolved.view.passageId) throw new Error(resolved.view.message ?? 'no takes');
      const reads = resolved.view.candidates.filter((candidate) => candidate.usable);
      if (reads.length < 2) throw new Error("fewer than two of this passage's takes can be compared; there is nothing to set side by side");
      const passageReads: MockPassageRead[] = reads.map((read) => ({
        item_guid: read.itemGuid,
        take_guid: read.takeGuid,
        source_file: read.sourceFile,
        source_start: read.sourceStart,
        source_length: read.sourceLength,
      }));
      const comparison = mockPassageComparison(resolved.view.passageId, chapterId, deps.chapterTitle(chapterId), resolved.spanText, passageReads);
      return deps.beginPassageComparison(resolved.view.passageId, comparison, reads.length);
    },
    workspaceUseTake: async (chapterId, firstToken, lastToken, candidateId) => {
      const { view } = await resolve(chapterId, firstToken, lastToken);
      const choice = view.candidates.find((candidate) => candidate.id === candidateId);
      if (!choice) return refused('not_offered', USE_TAKE_MESSAGES.notOffered);
      if (mode === 'standalone') return refused('standalone', USE_TAKE_MESSAGES.standalone);
      if (mode === 'not-running') return refused('not_running', USE_TAKE_MESSAGES.notRunning);
      if (mode === 'stale') return refused('stale', USE_TAKE_MESSAGES.stale);
      if (mode === 'recording') return refused('recording', USE_TAKE_MESSAGES.recording);
      if (mode === 'outdated') return refused('script_outdated', USE_TAKE_MESSAGES.scriptOutdated);
      if (!choice.usable) return refused('unusable', choice.reason ?? 'That take cannot be heard.');
      if (choice.active) return { outcome: 'done', message: USE_TAKE_MESSAGES.alreadyPlaying, changed: false };
      playing.set(view.passageId, choice.id);
      if (choice.action === 'pick_lane') return { outcome: 'started', message: USE_TAKE_MESSAGES.pickingLane, changed: false };
      if (choice.action === 'add_and_activate') {
        return { outcome: 'done', message: USE_TAKE_MESSAGES.addedAndMadeActive, changed: true };
      }
      return { outcome: 'done', message: USE_TAKE_MESSAGES.madeActive, changed: true };
    },
  };
}

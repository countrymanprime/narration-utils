import type { WorkspaceExtra, WorkspaceToken } from '../../api/contracts/workspace';

/** The flaggable kinds a token's status groups into (edit-and-proof-workspace.prd.md Evidence, "Flags the app can
 * already place on the text"): a run of consecutive skipped words, a run read short or with different text, a run
 * at the chapter's start or end never recorded, one misread word, or (from `extras`, not a token status) a run of
 * audio the alignment didn't match to any script word. `read`/`heading` never flag. */
export type FlagKind = 'skip' | 'partial' | 'not_recorded' | 'misread' | 'extra';

export type Flag = {
  id: string;
  kind: FlagKind;
  label: string;
  /** The first and last token index this flag covers (inclusive), for the legend's next/previous navigation. */
  tokenStart: number;
  tokenEnd: number;
  /** The token to seek to on this flag (its first token with a recorded time); undefined when nothing in the run
   * was ever heard (a pure skip has no audio position of its own). */
  seekTokenIndex?: number;
  heard?: string;
};

const FLAG_LABEL: Record<FlagKind, string> = {
  skip: 'Skipped',
  partial: 'Read short',
  not_recorded: 'Not recorded yet',
  misread: 'Misread',
  extra: 'Extra words',
};

function flagKind(status: WorkspaceToken['status']): FlagKind | undefined {
  switch (status) {
    case 'skip':
      return 'skip';
    case 'short_read':
    case 'different_text':
      return 'partial';
    case 'head':
    case 'tail':
      return 'not_recorded';
    case 'misread':
      return 'misread';
    default:
      return undefined;
  }
}

/** Groups the chapter's tokens and extra (unmatched) audio runs into flags: consecutive tokens sharing the same
 * flaggable kind become one flag (edit-and-proof-workspace.prd.md, "skipped (2 words)" in the visual spec), a
 * misread word is its own flag, and each extra run is its own flag. Flags are returned in token order, extras
 * placed after the token they followed (`afterToken`, or first if none). */
export function buildFlags(tokens: readonly WorkspaceToken[], extras: readonly WorkspaceExtra[]): Flag[] {
  const flags: Flag[] = [];
  let run: { kind: FlagKind; start: number; end: number; seekTokenIndex?: number; heard?: string } | undefined;

  const closeRun = () => {
    if (!run) return;
    flags.push({
      id: `token-${run.start}`,
      kind: run.kind,
      label: FLAG_LABEL[run.kind],
      tokenStart: run.start,
      tokenEnd: run.end,
      seekTokenIndex: run.seekTokenIndex,
      heard: run.heard,
    });
    run = undefined;
  };

  tokens.forEach((token, index) => {
    const kind = flagKind(token.status);
    if (!kind) {
      closeRun();
      return;
    }
    // A misread never merges with its neighbours: each is its own word, not a run of the same problem.
    if (kind === 'misread') {
      closeRun();
      flags.push({ id: `token-${index}`, kind, label: FLAG_LABEL[kind], tokenStart: index, tokenEnd: index, seekTokenIndex: index, heard: token.heard });
      return;
    }
    if (run && run.kind === kind) {
      run.end = index;
      if (run.seekTokenIndex === undefined && token.start !== undefined) run.seekTokenIndex = index;
    } else {
      closeRun();
      run = { kind, start: index, end: index, seekTokenIndex: token.start !== undefined ? index : undefined };
    }
  });
  closeRun();

  const byToken = flags.map((flag, order) => ({ order, at: flag.tokenStart, flag }));
  extras.forEach((extra, index) => {
    byToken.push({
      order: flags.length + index,
      at: (extra.afterToken ?? -1) + 0.5,
      flag: {
        id: `extra-${index}`,
        kind: 'extra',
        label: FLAG_LABEL.extra,
        tokenStart: extra.afterToken ?? -1,
        tokenEnd: extra.afterToken ?? -1,
        heard: extra.text,
      },
    });
  });
  byToken.sort((a, b) => a.at - b.at);
  return byToken.map((entry) => entry.flag);
}

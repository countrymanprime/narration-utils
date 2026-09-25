import { useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import type { CoverageJudgement, CoverageReport, CoverageRegionKind, ManuscriptChapter } from '../../types';
import { Button } from '../primitives/Button';
import { Disclosure } from '../primitives/Disclosure';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/Table';
import { REGION_LABEL, describePosition, describeRegion, formatAudioTime, paragraphRefs, plural, recordedTo, verdict } from './recordingCheckText';
import { TakeReviewPickups } from './TakeReviewPickups';

const MONO = "font-['IBM_Plex_Mono',ui-monospace,monospace]";
const EYEBROW = "font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.08em] text-[var(--text-muted)] uppercase";

// A pickup is one of the check's own interior gaps (recording-check-summary.prd.md, RS8, D33): a place worth reading
// on its own. An unread start or end is unfinished recording, not a pickup (RS2 A) - recordedTo() states it in the
// summary instead, so a chapter that is a third unread reads as "not finished", not as "3 pickups".
const PICKUP_KINDS: ReadonlySet<CoverageRegionKind> = new Set(['skip', 'short_read', 'different_text']);

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className={EYEBROW}>{label}</div>
      <div className={`mt-0.5 text-xl font-semibold ${MONO}`}>{value}</div>
      {hint && (
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {hint}
        </div>
      )}
    </div>
  );
}

/**
 * A stored recording check read out as a chapter summary first (recording-check-summary.prd.md Phase 1): the headline
 * (the host's judgement, ADR 0204 - the same rule the stage signal uses), the chapter figures, an unread start or end
 * stated as "recorded to" rather than listed, then the check's own interior gaps as one-line Pickups, with the full
 * paragraph table folded away (RS6 A) since every pickup already names and links to its paragraphs.
 */
export function RecordingCheckReport({
  chapter,
  report,
  judgement,
  goToParagraph,
}: {
  chapter: ManuscriptChapter;
  report: CoverageReport;
  /** The host's pass/fail for this report (ADR 0204); absent falls back to the plain word count. */
  judgement?: CoverageJudgement;
  /** Opens the manuscript at a paragraph (its index in the whole manuscript). */
  goToParagraph: (index: number) => void;
}) {
  const { complete, headline } = verdict(report, judgement);
  const refs = paragraphRefs(
    chapter,
    report.paragraphs.map((paragraph) => paragraph.id),
  );
  const rows = report.paragraphs.map((paragraph, index) => ({ paragraph, number: refs[index].number, missing: paragraph.tokens - paragraph.present }));
  const short = rows.filter((row) => row.missing > 0);
  const fullyRead = rows.length - short.length;
  // With text missing, the table holds only the paragraphs that are short, so they are read without scrolling past the rest;
  // a complete chapter keeps every paragraph. Either way it stays folded by default (RS6 A): a pickup already names its own
  // paragraphs, and largestGap's thin-read case (a paragraph with no region of its own) is the one reason to open it.
  const listed = short.length > 0 ? short : rows;
  const [paragraphsOpen, setParagraphsOpen] = useState(false);
  const pickups = report.regions.filter((region) => PICKUP_KINDS.has(region.kind));
  const api = useApi();
  // RS4 A (recording-check-summary.prd.md Phase 3): the chapter's other pickups - take review's unreviewed repeated
  // reads, a different kind from the check's own gaps above. A background count with nothing to guard or retry, so
  // a failure is silent (SILENT_CATCHES) and just leaves it out of the list.
  const [otherPickups, setOtherPickups] = useState<number>();
  useEffect(() => {
    setOtherPickups(undefined);
    let current = true;
    void api
      .findingsList({ category: 'pickup', chapterId: chapter.id, status: 'unreviewed' })
      .then((page) => {
        if (current) setOtherPickups(page.total);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [api, chapter.id]);
  const to = recordedTo(report, chapter);
  const presentPercent = report.bodyTokens > 0 ? Math.round((report.presentTokens / report.bodyTokens) * 100) : 100;
  const pace = report.playedSeconds > 0 ? Math.round((report.presentTokens / report.playedSeconds) * 60) : undefined;
  const mutedItems = report.items.filter((item) => item.status === 'muted').length;
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold" style={{ color: complete ? 'var(--text)' : 'var(--danger-text)' }}>
          {headline}
        </h3>
        {to && (
          <p className="mt-1 text-sm">
            {to.kind === 'tail'
              ? `Recorded to paragraph ${to.paragraph} of ${to.total} (${plural(to.wordsLeft, 'word')} left).`
              : `Start not read: paragraphs 1 to ${to.paragraph} (${plural(to.wordsLeft, 'word')}).`}
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <StatTile label="Text present" value={`${presentPercent}%`} hint={`${report.presentTokens.toLocaleString()} of ${plural(report.bodyTokens, 'word')}`} />
        <StatTile label="Paragraphs" value={`${fullyRead} of ${rows.length}`} hint="fully read" />
        <StatTile
          label="Audio checked"
          value={formatAudioTime(report.playedSeconds)}
          hint={`in ${plural(report.items.length, 'item')}${mutedItems > 0 ? ` (${mutedItems} muted)` : ''}`}
        />
        {pace !== undefined && <StatTile label="Pace" value={`about ${pace.toLocaleString()}/min`} />}
      </div>
      {report.extraTokens > 0 && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {plural(report.extraTokens, 'extra word')} heard (retakes, asides, a spoken title); extra words never count against the reading.
        </p>
      )}
      <section aria-labelledby="recording-check-pickups">
        <h3 id="recording-check-pickups" className={EYEBROW}>
          Pickups ({pickups.length})
        </h3>
        {pickups.length === 0 && !otherPickups ? (
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            None from this check.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {pickups.map((region, index) => {
              const regionRefs = paragraphRefs(chapter, region.paragraphIds);
              const first = regionRefs.find((ref) => ref.index !== undefined);
              const position = describePosition(region);
              return (
                <li
                  key={`${region.kind}-${index}`}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm"
                >
                  <div className="min-w-0 flex-1 basis-60">
                    <div>
                      <strong>{REGION_LABEL[region.kind]}</strong> · {describeRegion(region, regionRefs)}
                    </div>
                    {position && (
                      <div className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                        {position}
                      </div>
                    )}
                  </div>
                  {first?.index !== undefined && (
                    <Button variant="ghost" className="px-3 py-1" onClick={() => goToParagraph(first.index!)}>
                      Go to paragraph {first.number}
                    </Button>
                  )}
                </li>
              );
            })}
            {!!otherPickups && <TakeReviewPickups count={otherPickups} />}
          </ul>
        )}
      </section>
      {report.paragraphs.length > 0 && (
        <Disclosure
          title="Paragraph detail"
          summary={`${fullyRead} of ${report.paragraphs.length} fully recorded`}
          open={paragraphsOpen}
          onOpenChange={setParagraphsOpen}
        >
          <div className="mt-1 overflow-x-auto">
            {short.length > 0 && fullyRead > 0 && (
              <p className="mb-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                The paragraphs with missing words. The other {fullyRead} are fully recorded.
              </p>
            )}
            <Table label="Paragraphs">
              <TableHead>
                <TableRow>
                  <TableHeader>Paragraph</TableHeader>
                  <TableHeader align="right">Recorded</TableHeader>
                  <TableHeader align="right">Missing</TableHeader>
                  <TableHeader align="right">Longest gap</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {listed.map(({ paragraph, number, missing }) => {
                  return (
                    <TableRow key={paragraph.id}>
                      <TableCell>{number}</TableCell>
                      <TableCell align="right" className={MONO}>
                        {paragraph.present} of {paragraph.tokens}
                      </TableCell>
                      <TableCell align="right" className={MONO} style={missing > 0 ? { color: 'var(--danger-text)' } : undefined}>
                        {missing > 0 ? missing : '—'}
                      </TableCell>
                      <TableCell align="right" className={MONO}>
                        {paragraph.longestMissingRun > 0 ? paragraph.longestMissingRun : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Disclosure>
      )}
    </div>
  );
}

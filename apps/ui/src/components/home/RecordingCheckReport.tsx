import { useState } from 'react';
import type { CoverageReport, ManuscriptChapter } from '../../types';
import { Button } from '../primitives/Button';
import { Disclosure } from '../primitives/Disclosure';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/Table';
import { REGION_LABEL, describePosition, describeRegion, paragraphRefs, verdict } from './recordingCheckText';

const MONO = "font-['IBM_Plex_Mono',ui-monospace,monospace]";
const EYEBROW = "font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.08em] text-[var(--text-muted)] uppercase";

/**
 * A stored recording check read out (docs/prds/recording-coverage-analysis.prd.md Phase 6): how much of the chapter's text is in the
 * saved recording, each missing region with its paragraphs, first and last words and where it sits in the audio, and every paragraph's
 * count. It states counts only: whether they are good enough is the `recording` signal's call (Phase 7), not this view's.
 */
export function RecordingCheckReport({
  chapter,
  report,
  goToParagraph,
}: {
  chapter: ManuscriptChapter;
  report: CoverageReport;
  /** Opens the manuscript at a paragraph (its index in the whole manuscript). */
  goToParagraph: (index: number) => void;
}) {
  const { complete, headline, detail } = verdict(report);
  const refs = paragraphRefs(
    chapter,
    report.paragraphs.map((paragraph) => paragraph.id),
  );
  const rows = report.paragraphs.map((paragraph, index) => ({ paragraph, number: refs[index].number, missing: paragraph.tokens - paragraph.present }));
  const short = rows.filter((row) => row.missing > 0);
  const fullyRead = rows.length - short.length;
  // With text missing, the list is open and holds only the paragraphs that are short, so they are read without scrolling past the rest;
  // a complete chapter keeps every paragraph, folded.
  const listed = short.length > 0 ? short : rows;
  const [paragraphsOpen, setParagraphsOpen] = useState(!complete);
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold" style={{ color: complete ? 'var(--text)' : 'var(--danger-text)' }}>
          {headline}
        </h3>
        <p className="mt-1 text-sm">{detail}</p>
        <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          Extra words (false starts, retakes, a spoken title) never count against the reading.
          {report.extraTokens > 0 && ` ${report.extraTokens.toLocaleString()} extra ${report.extraTokens === 1 ? 'word was' : 'words were'} heard.`}
        </p>
      </div>
      {report.regions.length > 0 && (
        <section aria-labelledby="recording-check-regions">
          <h3 id="recording-check-regions" className={EYEBROW}>
            Missing text
          </h3>
          <ul className="mt-2 space-y-2">
            {report.regions.map((region, index) => {
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
          </ul>
        </section>
      )}
      {report.paragraphs.length > 0 && (
        <Disclosure
          title="Paragraphs"
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

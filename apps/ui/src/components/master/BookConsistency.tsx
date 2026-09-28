// The book-wide spread (docs/prds/delivery-platform-profiles.prd.md Phase 10, mockup 11 "Book consistency"): below the
// per-file table, one strip per numeric per-file level rule (RMS, peak, noise floor) showing the measured book's min,
// median and max, and where each judged file falls between them. No new chart primitive (studio-ui-primitives.prd.md
// keeps charts feature-local): a plain track built from the page's own design tokens, so it reads correctly in light and
// dark without forcing either (dark mode is a global theme only, D69 on #509).
import { useId } from 'react';
import type { DeliveryProfile, DeliveryRule, MeasureFileResult } from '../../types';
import { type BookSpreadStat, bookSpreadRows } from './bookSpread';
import { formatRuleValue } from './deliveryProfile';

const MUTED = { color: 'var(--text-muted)' };

const clampPct = (fraction: number) => Math.min(100, Math.max(0, fraction * 100));

/** A rule's spread as a horizontal band (mock 05's "Book consistency · RMS by chapter", mock-fidelity-primitives-and-
 * components.prd.md Phase 14): the rule's own min-max bound shaded as its target zone (the new `--ok-zone` token,
 * dashed edges), and one accent tick per judged file. The scale spans the rule's bound when it has one on that side,
 * and the book's own values otherwise (a boundless rule, or a bound the book's values sit outside of). */
function SpreadTrack({ rule, values, stat }: { rule: DeliveryRule; values: readonly number[]; stat: BookSpreadStat }) {
  const lo = Math.min(rule.min ?? stat.min, stat.min);
  const hi = Math.max(rule.max ?? stat.max, stat.max);
  const span = hi - lo || 1;
  const fraction = (value: number) => (value - lo) / span;
  const zoneLeft = rule.min !== null ? clampPct(fraction(rule.min)) : 0;
  const zoneRight = rule.max !== null ? clampPct(fraction(rule.max)) : 100;
  return (
    <div className="relative mt-2 h-[1.625rem] rounded-[3px]" style={{ background: 'var(--surface-2)' }} aria-hidden="true">
      {(rule.min !== null || rule.max !== null) && (
        <div
          className="absolute inset-y-0.5 rounded-[3px] border-x-2 border-dashed"
          style={{ left: `${zoneLeft}%`, width: `${Math.max(0, zoneRight - zoneLeft)}%`, background: 'var(--ok-zone)', borderColor: 'var(--ok)' }}
        />
      )}
      {values.map((value, index) => (
        <span
          key={index}
          className="absolute top-1/2 h-[1.125rem] w-[0.1875rem] -translate-1/2 rounded-full"
          style={{ left: `${clampPct(fraction(value))}%`, background: 'var(--accent)' }}
        />
      ))}
    </div>
  );
}

function SpreadRow({ rule, values, stat }: { rule: DeliveryRule; values: number[]; stat?: BookSpreadStat }) {
  const unit = rule.unit ? ` ${rule.unit}` : '';
  return (
    <div className="border-t border-[var(--border)] py-2.5 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-medium">{rule.label}</span>
        {stat ? (
          <span className="text-sm" style={MUTED}>
            {`${formatRuleValue(rule, stat.min)} to ${formatRuleValue(rule, stat.max)}${unit}, median ${formatRuleValue(rule, stat.median)}${unit}`}
          </span>
        ) : (
          <span className="text-sm italic" style={MUTED}>
            No measurements yet
          </span>
        )}
      </div>
      {stat ? (
        <>
          <SpreadTrack rule={rule} values={values} stat={stat} />
          <p className="mt-1 text-xs" style={MUTED}>
            Spread {formatRuleValue(rule, stat.max - stat.min)}
            {unit} across {stat.count === 1 ? 'the one measured file' : `${stat.count} measured files`}.
          </p>
        </>
      ) : (
        <div className="mt-2 h-[1.625rem] rounded-[3px]" style={{ background: 'var(--surface-2)' }} aria-hidden="true" />
      )}
    </div>
  );
}

/**
 * The book-wide spread (Phase 10), drawn as mock 05's "Book consistency" beside why a file fails (stage navigation Phase 8): min,
 * median and max across every measured file, for RMS, peak and noise floor - the numeric per-file level rules a profile carries,
 * whichever it has turned on. A rule reads only the files the app has actually judged it for (`met` or `not_met`); a file whose
 * value is `not_checked` (an MP3 before Phase 8) or `not_measurable` (silence, too short) never contributes, so an unmeasured book
 * shows "No measurements yet" rather than a zero or a guess. It is a section inside its caller's panel, not a panel of its own.
 */
export function BookConsistency({ profile, files, titled = true }: { profile: DeliveryProfile; files: readonly MeasureFileResult[]; titled?: boolean }) {
  const headingId = useId();
  const rows = bookSpreadRows(profile, files);
  if (rows.length === 0) return null;
  // Untitled inside a panel that already carries the name, so the page never has two regions called "Book consistency".
  return (
    <section aria-labelledby={titled ? headingId : undefined}>
      {titled && (
        <h3 id={headingId} className="section-label">
          Book consistency
        </h3>
      )}
      <p className="mt-1 text-sm" style={MUTED}>
        How RMS, peak and noise floor spread across every measured file, judged against {profile.name}.
      </p>
      <div className="mt-1">
        {rows.map((row) => (
          <SpreadRow key={row.rule.id} rule={row.rule} values={row.values} stat={row.stat} />
        ))}
      </div>
    </section>
  );
}

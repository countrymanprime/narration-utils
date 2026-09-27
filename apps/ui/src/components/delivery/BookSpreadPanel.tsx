// The book-wide spread (docs/prds/delivery-platform-profiles.prd.md Phase 10, mockup 11 "Book consistency"): below the
// per-file table, one strip per numeric per-file level rule (RMS, peak, noise floor) showing the measured book's min,
// median and max, and where each judged file falls between them. No new chart primitive (studio-ui-primitives.prd.md
// keeps charts feature-local): a plain track built from the page's own design tokens, so it reads correctly in light and
// dark without forcing either (dark mode is a global theme only, D69 on #509).
import type { DeliveryProfile, DeliveryRule, MeasureFileResult } from '../../types';
import { Panel } from '../primitives/Panel';
import { type BookSpreadStat, bookSpreadRows } from './bookSpread';
import { formatRuleValue } from './deliveryProfile';

const MUTED = { color: 'var(--text-muted)' };

const clampPct = (fraction: number) => Math.min(100, Math.max(0, fraction * 100));

/** A rule's spread as a horizontal track: the book's min-to-max band shaded within the rule's own bound, a median
 * tick, and one tick per judged file. The scale spans the rule's bound when it has one on that side, and the book's
 * own values otherwise (a boundless rule, or a bound the book's values sit outside of). */
function SpreadTrack({ rule, values, stat }: { rule: DeliveryRule; values: readonly number[]; stat: BookSpreadStat }) {
  const lo = Math.min(rule.min ?? stat.min, stat.min);
  const hi = Math.max(rule.max ?? stat.max, stat.max);
  const span = hi - lo || 1;
  const fraction = (value: number) => (value - lo) / span;
  const bandLeft = clampPct(fraction(stat.min));
  const bandWidth = Math.max(0, clampPct(fraction(stat.max)) - bandLeft);
  return (
    <div className="relative mt-2 h-2 rounded-full" style={{ background: 'var(--surface-2)' }} aria-hidden="true">
      <div
        className="absolute top-0 h-2 rounded-full"
        style={{ left: `${bandLeft}%`, width: `${bandWidth}%`, background: 'color-mix(in srgb, var(--ok) 40%, transparent)' }}
      />
      {values.map((value, index) => (
        <span
          key={index}
          className="absolute top-1/2 size-2 -translate-1/2 rounded-full border-2"
          style={{ left: `${clampPct(fraction(value))}%`, background: 'var(--surface)', borderColor: 'var(--text-muted)' }}
        />
      ))}
      <span
        className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 rounded-full"
        style={{ left: `${clampPct(fraction(stat.median))}%`, background: 'var(--accent)' }}
      />
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
        <div className="mt-2 h-2 rounded-full" style={{ background: 'var(--surface-2)' }} aria-hidden="true" />
      )}
    </div>
  );
}

/**
 * The book-wide spread (Phase 10): min, median and max across every measured file, for RMS, peak and noise floor -
 * the numeric per-file level rules a profile carries, whichever it has turned on. A rule reads only the files the
 * app has actually judged it for (`met` or `not_met`); a file whose value is `not_checked` (an MP3 before Phase 8)
 * or `not_measurable` (silence, too short) never contributes, so an unmeasured book shows "No measurements yet"
 * rather than a zero or a guess. Renders whenever the project has a delivery profile, even before anything is
 * measured, so the empty state is explicit rather than the panel simply not appearing.
 */
export function BookSpreadPanel({ profile, files }: { profile: DeliveryProfile; files: readonly MeasureFileResult[] }) {
  const rows = bookSpreadRows(profile, files);
  if (rows.length === 0) return null;
  return (
    <Panel title="Book-wide spread">
      <p className="text-sm" style={MUTED}>
        How RMS, peak and noise floor spread across every measured file, judged against {profile.name}.
      </p>
      <div className="mt-1">
        {rows.map((row) => (
          <SpreadRow key={row.rule.id} rule={row.rule} values={row.values} stat={row.stat} />
        ))}
      </div>
    </Panel>
  );
}

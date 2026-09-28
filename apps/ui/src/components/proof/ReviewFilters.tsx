import type { FindingReviewStatus, FindingSortKey, FindingsSummary } from '../../types';
import { Button } from '../primitives/Button';
import { Select } from '../primitives/Select';
import { Switch } from '../primitives/Switch';
import { analyzerLabel, categoryLabel, STATUS_LABELS } from './findingFormat';
import { CONFIDENT_MINIMUM, EMPTY_FILTERS, isFiltered, type ReviewFilterValues } from './reviewQuery';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  ...(['unreviewed', 'accepted', 'dismissed', 'deferred'] as const).map((status) => ({ value: status, label: STATUS_LABELS[status] })),
];

const SORT_OPTIONS: Array<{ value: FindingSortKey; label: string }> = [
  { value: 'chapter', label: 'Sort by chapter' },
  { value: 'time', label: 'Sort by project time' },
  { value: 'confidence', label: 'Sort by confidence, lowest first' },
  { value: 'severity', label: 'Sort by severity, most serious first' },
];

const isStatus = (value: string): value is '' | FindingReviewStatus => STATUS_OPTIONS.some((option) => option.value === value);
const isSort = (value: string): value is FindingSortKey => SORT_OPTIONS.some((option) => option.value === value);

/** The Review page's filters and sort. The kinds, checks and chapters offered are the ones the host says are present (FindingsSummary). */
export function ReviewFilters({
  summary,
  values,
  onChange,
}: {
  summary: FindingsSummary | undefined;
  values: ReviewFilterValues;
  onChange: (values: ReviewFilterValues) => void;
}) {
  const set = <K extends keyof ReviewFilterValues>(key: K, value: ReviewFilterValues[K]) => onChange({ ...values, [key]: value });
  const categories = [
    { value: '', label: 'All kinds' },
    ...(summary?.categories ?? []).map((category) => ({ value: category, label: categoryLabel(category) })),
  ];
  const analyzers = [
    { value: '', label: 'All checks' },
    ...(summary?.analyzers ?? []).map((analyzer) => ({ value: analyzer, label: analyzerLabel(analyzer) })),
  ];
  const chapters = [
    { value: '', label: 'All chapters' },
    ...(summary?.chapters ?? []).map((chapter) => ({ value: chapter.id, label: chapter.title || chapter.id })),
  ];
  return (
    <div role="group" aria-label="Filter findings" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select label="Status" value={values.status} onChange={(value) => isStatus(value) && set('status', value)} options={STATUS_OPTIONS} />
        <Select label="Kind of finding" value={values.category} onChange={(value) => set('category', value)} options={categories} />
        <Select label="Check" value={values.analyzer} onChange={(value) => set('analyzer', value)} options={analyzers} />
        <Select label="Chapter" value={values.chapterId} onChange={(value) => set('chapterId', value)} options={chapters} />
        <Select label="Sort" value={values.sort} onChange={(value) => isSort(value) && set('sort', value)} options={SORT_OPTIONS} />
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Switch checked={values.confidentOnly} onChange={(checked) => set('confidentOnly', checked)}>
          Only findings scored {Math.round(CONFIDENT_MINIMUM * 100)}% or more
        </Switch>
        <Switch checked={values.includeNotInLatestRun} onChange={(checked) => set('includeNotInLatestRun', checked)}>
          Include findings the latest run did not repeat
        </Switch>
        {isFiltered(values) && (
          <Button variant="ghost" onClick={() => onChange({ ...EMPTY_FILTERS, sort: values.sort })}>
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}

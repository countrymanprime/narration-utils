// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { wireSettings } from '../../api/mockFixtures';
import type { ScopedSettingField } from '../../types';
import { RecordingCheckSummary, recordingRule } from './RecordingCheckSummary';

const fields = (): ScopedSettingField[] => wireSettings().RecordingCoverage;
const withValue = (key: string, effectiveValue: string) => fields().map((field) => (field.key === key ? { ...field, effectiveValue } : field));

afterEach(cleanup);

describe('RecordingCheckSummary', () => {
  it('states the rule the effective values make, as a percentage and a word count', () => {
    expect(recordingRule(fields())).toBe(
      'A chapter counts as recorded when each paragraph has at least 80% of its words read and no more than 3 words in a row are missing.',
    );
  });

  it('follows an edited threshold and says one word in the singular', () => {
    expect(recordingRule(withValue('max_missing_run', '1'))).toContain('no more than 1 word in a row');
    expect(recordingRule(withValue('min_paragraph_present', '1'))).toContain('at least 100% of its words');
  });

  it('shows a value it cannot read as it is rather than a wrong number', () => {
    expect(recordingRule(withValue('min_paragraph_present', ''))).toContain('at least (not set) of its words');
  });

  it('labels the values Proposed and uncalibrated and says which settings make earlier checks out of date', () => {
    render(<RecordingCheckSummary fields={fields()} scope="global" />);
    expect(screen.getByText('Proposed values, not yet calibrated')).toBeTruthy();
    expect(screen.getByText(/chosen on synthetic test recordings and have not been checked against real recordings yet/)).toBeTruthy();
    expect(screen.getByText(/makes earlier checks out of date/)).toBeTruthy();
    expect(screen.queryByText(/uses the Global one/)).toBeNull();
  });

  it('tells a project that a blank value uses the Global one', () => {
    render(<RecordingCheckSummary fields={fields()} scope="project" />);
    expect(screen.getByText(/A value left blank here uses the Global one/)).toBeTruthy();
  });
});

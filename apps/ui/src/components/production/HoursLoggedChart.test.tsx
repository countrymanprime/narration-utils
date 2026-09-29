// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HoursLoggedChart } from './HoursLoggedChart';

afterEach(cleanup);

const points = [
  { date: '2026-09-27', hoursLogged: 1.5 },
  { date: '2026-09-28', hoursLogged: 4 },
  { date: '2026-09-29', hoursLogged: 6.25 },
];

describe('HoursLoggedChart', () => {
  it('draws the hours logged so far as a line, named for a screen reader with its total, and marks the delivery date', () => {
    render(<HoursLoggedChart points={points} deadline={{ date: '2026-10-14', daysLeft: 15 }} today="2026-09-29" />);
    const chart = screen.getByRole('img', { name: /Hours logged: 6:15 over 3 days/ });
    expect(chart.getAttribute('aria-label')).toContain('delivery due Oct 14');
    expect(chart.querySelector('polyline')?.getAttribute('points')?.split(' ')).toHaveLength(3);
    expect(screen.getByText(/delivery Oct 14/)).toBeTruthy();
  });

  it('says so, and draws no line, when no hours are logged', () => {
    render(<HoursLoggedChart points={[]} deadline={null} today="2026-09-29" />);
    expect(screen.getByText('No hours logged yet: start a timer on a chapter.')).toBeTruthy();
    expect(document.querySelector('polyline')).toBeNull();
  });

  it('says so when the hours could not be read', () => {
    render(<HoursLoggedChart points={null} deadline={null} today="2026-09-29" />);
    expect(screen.getByText('The hours logged could not be read.')).toBeTruthy();
  });
});

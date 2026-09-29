import { describe, expect, it } from 'vitest';
import { weekHours } from './thisWeek';

const points = [
  { date: '2026-09-20', hoursLogged: 2 },
  { date: '2026-09-21', hoursLogged: 2 },
  { date: '2026-09-22', hoursLogged: 5 },
  { date: '2026-09-23', hoursLogged: 5 },
  { date: '2026-09-24', hoursLogged: 6.5 },
];

describe('weekHours', () => {
  it('splits the last seven days (today last) into hours per day from the cumulative log', () => {
    const week = weekHours(points, '2026-09-26');
    expect(week?.days.map((day) => day.date)).toEqual(['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26']);
    expect(week?.days.map((day) => day.hours)).toEqual([2, 0, 3, 0, 1.5, 0, 0]);
    expect(week?.total).toBe(6.5);
  });

  it('counts only the days inside the week, with hours logged before it left out', () => {
    const week = weekHours(points, '2026-09-28');
    expect(week?.days[0].date).toBe('2026-09-22');
    expect(week?.total).toBe(4.5);
  });

  it('is zero for a week with nothing logged, and for a log that could not be read', () => {
    expect(weekHours([], '2026-09-26')?.total).toBe(0);
    expect(weekHours(null, '2026-09-26')).toBeNull();
  });
});

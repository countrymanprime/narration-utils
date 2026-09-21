// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AboutPanel } from './AboutPanel';

afterEach(cleanup);

describe('AboutPanel', () => {
  it('names the application and shows the version the host reports', () => {
    render(<AboutPanel version="0.2.7" />);
    expect(screen.getByText('Narration Utils')).toBeTruthy();
    expect(screen.getByText('Version 0.2.7')).toBeTruthy();
    expect(screen.queryByText(/development build/i)).toBeNull();
  });

  it('says so when this is a development build, which has no release to compare with', () => {
    render(<AboutPanel version="0.0.0-dev" />);
    expect(screen.getByText('Version 0.0.0-dev')).toBeTruthy();
    expect(screen.getByText(/development build/i)).toBeTruthy();
  });
});

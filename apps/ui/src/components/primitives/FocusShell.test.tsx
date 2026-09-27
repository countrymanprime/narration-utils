// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FocusShell } from './FocusShell';

afterEach(cleanup);

describe('FocusShell', () => {
  it('lays out status, rail, main and commands, each a named landmark', () => {
    render(
      <FocusShell status="REC · P&R" rail="Last punch: Ch 7, p. 12" commands="Space to record">
        The script text
      </FocusShell>,
    );
    expect(within(screen.getByRole('region', { name: 'Status' })).getByText('REC · P&R')).toBeTruthy();
    expect(within(screen.getByRole('complementary', { name: 'Rail' })).getByText('Last punch: Ch 7, p. 12')).toBeTruthy();
    expect(within(screen.getByRole('main')).getByText('The script text')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Commands' })).getByText('Space to record')).toBeTruthy();
  });

  it('accepts a label override for each of the three non-main landmarks', () => {
    render(
      <FocusShell status="s" statusLabel="Session status" rail="r" railLabel="Session rail" commands="c" commandsLabel="Booth commands">
        m
      </FocusShell>,
    );
    expect(screen.getByRole('region', { name: 'Session status' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Session rail' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Booth commands' })).toBeTruthy();
  });

  it('follows the app theme: it sets no surface, theme or colour-scheme of its own (ADR 0363)', () => {
    const { container } = render(
      <FocusShell status="s" rail="r" commands="c">
        m
      </FocusShell>,
    );
    expect(container.querySelector('[data-surface], [data-theme]')).toBeNull();
    for (const element of container.querySelectorAll<HTMLElement>('*')) expect(element.style.colorScheme).toBe('');
  });

  it('renders no rail landmark when rail is omitted', () => {
    render(
      <FocusShell status="s" commands="c">
        m
      </FocusShell>,
    );
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('renders no rail landmark when railCollapsed is true, even though rail content was given', () => {
    render(
      <FocusShell status="s" rail="Session details" railCollapsed commands="c">
        m
      </FocusShell>,
    );
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByText('Session details')).toBeNull();
  });

  it('is a full-viewport layout: one shell region, not nested inside another FocusShell', () => {
    render(
      <FocusShell status="s" commands="c">
        m
      </FocusShell>,
    );
    // Exactly one of each landmark - the shell composes, it never doubles up on itself.
    expect(screen.getAllByRole('region', { name: 'Status' })).toHaveLength(1);
    expect(screen.getAllByRole('region', { name: 'Commands' })).toHaveLength(1);
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('renders the script region as main by default, for a standalone route with no other main on the page', () => {
    render(
      <FocusShell status="s" commands="c">
        The script text
      </FocusShell>,
    );
    expect(within(screen.getByRole('main')).getByText('The script text')).toBeTruthy();
  });

  it('renders no main landmark when asMain is false, for a host page that already has its own (a full-size Dialog), while every other landmark stays', () => {
    render(
      <FocusShell status="s" rail="r" commands="c" asMain={false}>
        The script text
      </FocusShell>,
    );
    expect(screen.queryByRole('main')).toBeNull();
    expect(screen.getByText('The script text')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Status' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Rail' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Commands' })).toBeTruthy();
  });
});

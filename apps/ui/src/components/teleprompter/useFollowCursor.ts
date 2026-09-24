import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** The part of the viewport the current word may sit in without the reader scrolling (ADR 0024): 25% to 70% of its height. */
const FOLLOW_BAND = { top: 0.25, bottom: 0.7 } as const;
/**
 * How long a scroll has to be still before a paused reader checks whether the current word is back in the band. It is not a
 * resume timer (ADR 0119): it only waits out a wheel's smooth scroll or a touch's momentum, which move the text with no
 * input event of their own, so the word passing through the band mid-scroll does not resume following.
 */
export const SCROLL_SETTLE_MS = 150;

const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' ']);
// Roles whose arrow keys move a selection or a value, not the page. Exported for `ReadingControlBar`'s Space shortcut
// (read-aloud-control-bar.prd.md Phase 3, Q10), which reuses the same "is this a widget, not the page" check.
export const KEY_WIDGET_ROLES = new Set([
  'combobox',
  'grid',
  'listbox',
  'menu',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'radiogroup',
  'slider',
  'spinbutton',
  'tab',
  'tablist',
  'textbox',
  'tree',
  'treeitem',
]);
export const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
export const SPACE_ACTIVATES = 'button, a[href], summary, [role="button"], [role="checkbox"], [role="switch"]';

const prefersReducedMotion = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function inFollowBand({ top, bottom }: { top: number; bottom: number }, viewportHeight: number): boolean {
  return top > viewportHeight * FOLLOW_BAND.top && bottom < viewportHeight * FOLLOW_BAND.bottom;
}

const currentWord = (reader: HTMLElement | null): HTMLElement | null => reader?.querySelector<HTMLElement>('[data-current-word]') ?? null;

/** Whether the reader's current word is inside the follow band; false when there is no current word. */
function currentWordInBand(reader: HTMLElement | null): boolean {
  const word = currentWord(reader);
  return word !== null && inFollowBand(word.getBoundingClientRect(), window.innerHeight);
}

/** Brings the current word back to the middle when it has left the band; instantly under reduced motion. */
export function scrollCursorIntoView(reader: HTMLElement | null) {
  const word = currentWord(reader);
  if (!word || typeof word.scrollIntoView !== 'function') return;
  if (inFollowBand(word.getBoundingClientRect(), window.innerHeight)) return;
  word.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

/** A key press that scrolls the page: a scrolling key nothing else took (a field, a widget's arrows, Space on a button). */
export function isScrollKey(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return false;
  if (!SCROLL_KEYS.has(event.key)) return false;
  const target = event.target;
  if (!(target instanceof Element)) return true;
  if (target.closest(EDITABLE)) return false;
  const role = target.getAttribute('role');
  if (role && KEY_WIDGET_ROLES.has(role)) return false;
  return !(event.key === ' ' && target.closest(SPACE_ACTIVATES));
}

// A press on an element's own vertical scrollbar lands on the element itself, to the right of its content box.
function isScrollbarPress(event: PointerEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.scrollHeight <= target.clientHeight) return false;
  return event.clientX - target.getBoundingClientRect().left >= target.clientLeft + target.clientWidth;
}

// The element that scrolls the reader: its nearest ancestor that scrolls vertically, or the whole document.
function scrollRoot(reader: HTMLElement): Element {
  for (let node = reader.parentElement; node; node = node.parentElement) {
    const { overflowY } = window.getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return document.documentElement;
}

export type FollowCursor = {
  /** Whether the reader keeps the current word in view. False after the narrator scrolls, until the word is back in the band. */
  following: boolean;
  /** Follow again now (the Follow control): the reader scrolls straight back to the current word. */
  resume: () => void;
  /** Attach to the reader (`ReaderText`'s `readerRef`): where the current word is looked for, and whose scroll input counts. */
  readerRef: RefObject<HTMLDivElement | null>;
};

/**
 * Following for the shared reader (teleprompter-engines-and-input-devices.prd.md Phase 10, ADR 0119). Following pauses when
 * the narrator scrolls - a wheel, a touch drag, a scrolling key or a press on the scrollbar, never a scroll event, because the
 * reader's own follow scrolling fires those too - and resumes by itself once the current word is back inside the follow band
 * (the narrator scrolled back, or read on until the word came into it), or at once from `resume`. Each session starts
 * following.
 */
export function useFollowCursor({ active, cursor }: { active: boolean; cursor: number }): FollowCursor {
  const readerRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (active) setFollowing(true);
  }

  const followingRef = useRef(following);
  const moving = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    followingRef.current = following;
  }, [following]);

  const tryResume = useCallback(() => {
    if (currentWordInBand(readerRef.current)) setFollowing(true);
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    const markMoving = () => {
      moving.current = true;
      clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => {
        moving.current = false;
        if (!followingRef.current) tryResume();
      }, SCROLL_SETTLE_MS);
    };
    const inReaderScroll = (target: EventTarget | null): boolean => {
      const reader = readerRef.current;
      return reader !== null && target instanceof Node && scrollRoot(reader).contains(target);
    };
    const pause = () => {
      followingRef.current = false;
      setFollowing(false);
      markMoving();
    };
    const onScrollInput = (event: Event) => {
      if (inReaderScroll(event.target)) pause();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (isScrollKey(event) && (event.target === document.body || inReaderScroll(event.target))) pause();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (inReaderScroll(event.target) && isScrollbarPress(event)) pause();
    };
    // Only while paused: the scroll a pause started (or momentum after it) keeps the settle window open.
    const onScroll = () => {
      if (!followingRef.current) markMoving();
    };
    const passive = { passive: true } as const;
    document.addEventListener('wheel', onScrollInput, passive);
    document.addEventListener('touchmove', onScrollInput, passive);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, passive);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('wheel', onScrollInput);
      document.removeEventListener('touchmove', onScrollInput);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', onScroll, { capture: true });
      clearTimeout(settleTimer.current);
      moving.current = false;
    };
  }, [active, tryResume]);

  // Reading on can bring the word into the band too; checked on each step once any scroll has settled.
  useEffect(() => {
    if (active && !following && !moving.current) tryResume();
  }, [active, following, cursor, tryResume]);

  const resume = useCallback(() => setFollowing(true), []);
  return { following, resume, readerRef };
}

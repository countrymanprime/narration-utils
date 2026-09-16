import { useCallback, useEffect, useState, type RefObject } from 'react';

export type ManuscriptSelection = { text: string; paragraphIndex?: number; anchorStart?: number; anchorEnd?: number; rect: DOMRect };

// Pure and independently testable: walks up from wherever the browser
// selection anchored to find which rendered paragraph it falls in (each
// paragraph row carries a data-paragraph attribute - see ParagraphView.tsx).
export function paragraphIndexFromNode(node: Node | null): number | undefined {
  let el = node instanceof Element ? node : (node?.parentElement ?? null);
  while (el) {
    const attr = el.getAttribute('data-paragraph');
    if (attr !== null) return Number(attr);
    el = el.parentElement;
  }
  return undefined;
}

// A valid manuscript selection stays within one line, or spills into at most
// one adjacent line - never further, and (since only one chapter's
// paragraphs are ever mounted at a time - see Manuscript.tsx) structurally
// never across a chapter boundary either. Anything wider collapses to
// "invalid" rather than silently annotating a multi-paragraph span.
function paragraphElement(node: Node | null): HTMLElement | null {
  let el = node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  while (el && !el.hasAttribute('data-paragraph')) el = el.parentElement;
  return el;
}

function offsetsWithinParagraph(range: Range): { paragraphIndex?: number; anchorStart?: number; anchorEnd?: number } {
  const start = paragraphElement(range.startContainer);
  const end = paragraphElement(range.endContainer);
  if (!start || start !== end) return {};
  const before = document.createRange();
  before.selectNodeContents(start);
  before.setEnd(range.startContainer, range.startOffset);
  const anchorStart = before.toString().length;
  return { paragraphIndex: Number(start.dataset.paragraph), anchorStart, anchorEnd: anchorStart + range.toString().length };
}

// Selecting text inside the reading pane surfaces a floating "+ Note / + Story Bible"
// toolbar anchored to the selection, instead of a per-paragraph button.
// Returns `clear()` too, so callers can dismiss the toolbar immediately after
// acting on a selection rather than waiting for the next mouseup/selection
// change to notice the browser selection was cleared.
export function useTextSelection(containerRef: RefObject<HTMLElement | null>): { selection?: ManuscriptSelection; clear: () => void } {
  const [selection, setSelection] = useState<ManuscriptSelection>();

  useEffect(() => {
    const compute = () => {
      const sel = window.getSelection();
      const container = containerRef.current;
      const text = sel?.toString().trim();
      if (!sel || !container || !text || sel.rangeCount === 0 || !container.contains(sel.anchorNode)) {
        setSelection(undefined);
        return;
      }
      const range = sel.getRangeAt(0);
      // jsdom (used by the test suite) does not implement getBoundingClientRect
      // on Range at all in some versions - fall back to an empty rect there
      // rather than crashing; real browsers always support this.
      const rect = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : new DOMRect();
      setSelection({ text, rect, ...offsetsWithinParagraph(range) });
    };
    // selectionchange catches the selection collapsing (e.g. after we
    // programmatically clear it, or the user clicks elsewhere without
    // dragging a new selection) - mouseup alone would miss that.
    document.addEventListener('mouseup', compute);
    document.addEventListener('selectionchange', compute);
    return () => {
      document.removeEventListener('mouseup', compute);
      document.removeEventListener('selectionchange', compute);
    };
  }, [containerRef]);

  const clear = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setSelection(undefined);
  }, []);

  return { selection, clear };
}

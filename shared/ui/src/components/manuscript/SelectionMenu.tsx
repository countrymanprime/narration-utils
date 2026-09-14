import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBookOpen, faNoteSticky } from '@fortawesome/free-solid-svg-icons';
import type { ManuscriptSelection } from '../../hooks/useTextSelection';

// A single, opaque rich-text toolbar. Rendering in document.body prevents it
// being clipped by reader cards and allows placement to be clamped precisely.
export function SelectionMenu({
  selection,
  addNote,
  addToStoryBible,
  dismiss,
}: {
  selection: ManuscriptSelection;
  addNote: () => void;
  addToStoryBible: () => void;
  dismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const place = () => {
    const width = ref.current?.offsetWidth ?? 220;
    const height = ref.current?.offsetHeight ?? 36;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, selection.rect.left + selection.rect.width / 2 - width / 2));
    const above = selection.rect.top - height - 10;
    setPosition({ left, top: above >= 8 ? above : Math.min(window.innerHeight - height - 8, selection.rect.bottom + 10) });
  };
  useLayoutEffect(place, [selection.rect.left, selection.rect.top, selection.rect.width, selection.rect.height]);
  useEffect(() => {
    window.addEventListener('resize', place);
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('keydown', escape);
    };
  });
  return createPortal(
    <div
      ref={ref}
      className="selection-toolbar"
      role="toolbar"
      aria-label="Selected manuscript text actions"
      style={position}
      onMouseDown={(event) => event.preventDefault()}
    >
      <button className="btn btn-primary text-xs" aria-label="+ Note" onClick={addNote}>
        <FontAwesomeIcon icon={faNoteSticky} /> Note
      </button>
      <button className="btn btn-ghost text-xs" aria-label="+ Story Bible" onClick={addToStoryBible}>
        <FontAwesomeIcon icon={faBookOpen} /> Story Bible
      </button>
    </div>,
    document.body,
  );
}

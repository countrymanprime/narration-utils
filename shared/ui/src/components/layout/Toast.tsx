import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import { useEffect, useState } from 'react';

export function Toast({ text, dismiss }: { text: string; dismiss: () => void }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const fade = window.setTimeout(() => setLeaving(true), 2_250);
    const remove = window.setTimeout(dismiss, 2_400);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(remove);
    };
  }, [dismiss]);
  return (
    <div
      className={`ease fixed right-5 bottom-5 z-50 flex items-center gap-[0.6rem] rounded-[0.4rem] bg-[var(--text)] px-4 py-[0.65rem] text-[0.85rem] text-[var(--bg)] shadow-[var(--shadow)] transition-[opacity,transform] duration-150 ${leaving ? 'translate-y-1 opacity-0' : 'opacity-100'}`}
      role="status"
    >
      {text}
      <button aria-label="Dismiss message" onClick={dismiss}>
        <FontAwesomeIcon icon={faXmark} />
      </button>
    </div>
  );
}

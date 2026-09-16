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
    <div className={`toast ${leaving ? 'toast-leaving' : ''}`} role="status">
      {text}
      <button aria-label="Dismiss message" onClick={dismiss}>
        <FontAwesomeIcon icon={faXmark} />
      </button>
    </div>
  );
}

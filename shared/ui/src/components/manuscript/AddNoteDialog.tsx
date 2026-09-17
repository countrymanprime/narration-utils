import { useState } from 'react';
import { Button } from '../primitives/Button';
import { Dialog } from '../primitives/Dialog';

export function AddNoteDialog({ anchorText, confirm, cancel }: { anchorText: string; confirm: (text: string) => void; cancel: () => void }) {
  const [text, setText] = useState('');
  return (
    <Dialog
      title="Add note"
      onClose={cancel}
      actions={
        <>
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!text.trim()} onClick={() => confirm(text.trim())}>
            Add note
          </Button>
        </>
      }
    >
      <p className="text-sm italic" style={{ color: 'var(--text-muted)' }}>
        Note for: "{anchorText}"
      </p>
      <label className="label mb-1.5 mt-3 block" htmlFor="note-text">
        Note
      </label>
      <textarea id="note-text" className="input" rows={3} autoFocus value={text} onChange={(event) => setText(event.target.value)} />
    </Dialog>
  );
}

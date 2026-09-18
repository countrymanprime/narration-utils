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
      <label className="mb-1.5 mt-3 block text-[0.82rem] font-medium text-[var(--text-muted)]" htmlFor="note-text">
        Note
      </label>
      <textarea
        id="note-text"
        className="min-h-[var(--control-height)] w-full rounded-[var(--control-radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-[0.6rem] text-[0.88rem] leading-[1.35] text-[var(--text)] focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-[var(--accent)]"
        rows={3}
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
    </Dialog>
  );
}

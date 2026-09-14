import { useState } from 'react';

export function AddNoteDialog({ anchorText, confirm, cancel }: { anchorText: string; confirm: (text: string) => void; cancel: () => void }) {
  const [text, setText] = useState('');
  return (
    <div className="confirm-backdrop" role="dialog" aria-modal="true" aria-label="Add note">
      <div className="confirm-dialog">
        <div className="panel-head">
          <h2 className="font-semibold">Add note</h2>
        </div>
        <div className="panel-body">
          <p className="text-sm italic" style={{ color: 'var(--text-muted)' }}>
            Note for: "{anchorText}"
          </p>
          <label className="label mb-1.5 mt-3 block" htmlFor="note-text">
            Note
          </label>
          <textarea id="note-text" className="input" rows={3} autoFocus value={text} onChange={(event) => setText(event.target.value)} />
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn btn-ghost" onClick={cancel}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={!text.trim()} onClick={() => confirm(text.trim())}>
              Add note
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

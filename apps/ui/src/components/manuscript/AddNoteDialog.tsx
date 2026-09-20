import { useState } from 'react';
import { Button } from '../primitives/Button';
import { Dialog } from '../primitives/Dialog';
import { Field } from '../primitives/Field';

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
      <div className="mt-3">
        <Field label="Note" textarea autoFocus value={text} onChange={setText} />
      </div>
    </Dialog>
  );
}

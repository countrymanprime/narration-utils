import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import type { ManuscriptNote } from '../../types';

export function NotesPanel({ notes, remove }: { notes: ManuscriptNote[]; remove: (id: string) => void }) {
  return (
    <div>
      <div className="section-label mb-2">Notes {notes.length > 0 && `(${notes.length})`}</div>
      {notes.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
          No notes in this chapter yet. Use the + button on a paragraph to add one.
        </p>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li key={note.id} className="flex items-start justify-between gap-2 rounded p-2 text-sm" style={{ background: 'var(--surface-2)' }}>
              <span>
                <span className="f-mono text-xs" style={{ color: 'var(--text-faint)' }}>
                  Paragraph {note.paragraph}
                </span>
                <br />
                {note.text}
              </span>
              <button className="icon-btn flex-none" aria-label={`Delete note on paragraph ${note.paragraph}`} onClick={() => remove(note.id)}>
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

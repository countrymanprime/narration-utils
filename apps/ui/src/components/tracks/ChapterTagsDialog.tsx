import { useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { Button } from '../primitives/Button';
import { Checkbox } from '../primitives/Checkbox';
import { Dialog } from '../primitives/Dialog';
import { Field } from '../primitives/Field';
import type { ChapterTagsPreview } from '../../types';

const IDLE: ChapterTagsPreview = { chapters: [], ready: false };

/** Chapter tag embedding (reaper-automation-follow-through PRD, Phase 12). This never talks to REAPER: it reads
 * Phase 11's last "Prepare chapter render" result (the per-chapter MP3 titles and files) to build a chapter
 * timeline, then writes ID3v2 CHAP/CTOC frames into a NEW copy of a separate, already-rendered combined-book MP3
 * the narrator names below - never into the per-chapter files, and never overwriting the file they name. Reachable
 * from the Tracks page next to "Link chapters…", "Pickups…" and "Prepare chapter render…" (Phases 7, 9 and 11),
 * not a new nav item. */
export function ChapterTagsDialog({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const [preview, setPreview] = useState<ChapterTagsPreview>(IDLE);
  const [previewError, setPreviewError] = useState('');
  const [destPath, setDestPath] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [embedding, setEmbedding] = useState(false);
  const [outputPath, setOutputPath] = useState('');
  const [embedError, setEmbedError] = useState('');

  useEffect(() => {
    let active = true;
    void api
      .chapterTagsPreview()
      .then((next) => {
        if (active) setPreview(next);
      })
      .catch((reason: unknown) => {
        if (active) setPreviewError(String(reason));
      });
    return () => {
      active = false;
    };
  }, [api]);

  const canEmbed = preview.ready && destPath.trim() !== '' && confirmed && !embedding;

  const embed = () => {
    setEmbedError('');
    setOutputPath('');
    setEmbedding(true);
    api
      .chapterTagsEmbed(destPath)
      .then((result) => setOutputPath(result.outputPath))
      .catch((reason: unknown) => setEmbedError(String(reason)))
      .finally(() => setEmbedding(false));
  };

  return (
    <Dialog
      title="Embed chapter tags"
      onClose={embedding ? undefined : onClose}
      escapeCloses={!embedding}
      description="Add ID3 chapter markers to a copy of an already-rendered MP3, using the chapter names and lengths from your last chapter render. The file you choose below is never changed; a new, tagged copy is written beside it."
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={embedding}>
            Close
          </Button>
          <Button onClick={embed} disabled={!canEmbed} pending={embedding}>
            Embed chapter tags
          </Button>
        </>
      }
    >
      {previewError && (
        <p role="alert" className="text-sm" style={{ color: 'var(--danger-text)' }}>
          {previewError}
        </p>
      )}
      {!previewError && preview.chapters.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          No chapter render is configured yet. Use &ldquo;Prepare chapter render…&rdquo; first.
        </p>
      )}
      {preview.chapters.length > 0 && (
        <div>
          <p className="text-sm font-semibold">Chapters from your last chapter render</p>
          <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-sm">
            {preview.chapters.map((chapter) => (
              <li key={chapter.path} className="flex items-center justify-between gap-2">
                <span>{chapter.title}</span>
                {!chapter.rendered && (
                  <span className="text-xs" style={{ color: 'var(--danger-text)' }}>
                    not rendered yet
                  </span>
                )}
              </li>
            ))}
          </ul>
          {!preview.ready && (
            <p className="mt-2 text-sm" style={{ color: 'var(--danger-text)' }}>
              Press Render in REAPER first: every chapter file must exist before chapter tags can be timed from them.
            </p>
          )}
        </div>
      )}

      <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
        <Field
          label="Combined book MP3 to add chapters to"
          value={destPath}
          onChange={setDestPath}
          disabled={embedding}
          placeholder="C:\Books\Alice\Alice in Wonderland.mp3"
        />
        <div className="mt-2" style={{ color: 'var(--text-muted)' }}>
          <Checkbox checked={confirmed} onChange={setConfirmed} disabled={embedding}>
            I understand this writes a new file beside the one above; the original file is not changed.
          </Checkbox>
        </div>
      </div>

      {outputPath && (
        <p className="mt-3 text-sm font-semibold" style={{ color: 'var(--text)' }}>
          Wrote {outputPath}
        </p>
      )}
      {embedError && (
        <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--danger-text)' }}>
          {embedError}
        </p>
      )}
    </Dialog>
  );
}

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileLines, faLock } from '@fortawesome/free-solid-svg-icons';
import type { GuideEntity } from '../../types';
import { allEvidence, categoryLabel, highlightTerms } from '../../state';
import { TooltipTarget } from '../primitives/Tooltip';

// A read-only mirror of the Story Bible's own detail panel (GuideDetail),
// for previewing an entity from the Manuscript without leaving the reader.
// Editing (name, aliases, relationships, lock/delete) stays exclusive to
// Story Bible - "Open in Story Bible" is the way in for that.
export function EntitySummary({ entity, jumpToLine }: { entity: GuideEntity; jumpToLine: (chapter: string, paragraph: number) => void }) {
  const evidence = allEvidence(entity);
  return (
    <div className="space-y-4">
      {entity.locked && (
        <p className="rounded px-3 py-1.5 text-xs" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
          <FontAwesomeIcon icon={faLock} className="mr-1.5" />
          Locked entry
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className={`badge badge-${entity.category}`}>{categoryLabel(entity.category)}</span>
        <span className="badge" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
          {entity.review_state}
        </span>
        <span className="f-mono text-xs" style={{ color: 'var(--text-faint)' }}>
          {entity.occurrence_count} occurrences
        </span>
      </div>
      <div>
        <div className="label mb-1">Pronunciation</div>
        <p className="f-mono text-sm">{entity.pronunciation.ipa || 'Not generated'}</p>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--text-faint)' }}>
          Source: {entity.pronunciation.source} · Confidence: {entity.pronunciation.confidence}
        </p>
      </div>
      {entity.description.text && (
        <div>
          <div className="label mb-1">Description</div>
          <p className="text-sm">{entity.description.text}</p>
        </div>
      )}
      <div>
        <div className="label mb-1.5">Aliases</div>
        {entity.aliases.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
            None.
          </p>
        ) : (
          <div className="space-y-2">
            {entity.aliases.map((alias) => (
              <div key={alias.text} className="rounded border px-2 py-1.5" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
                <div className="f-mono text-sm">{alias.text}</div>
                <div className="mt-0.5 text-xs" style={{ color: 'var(--text-faint)' }}>
                  {alias.pronunciation.ipa || 'Not generated'} · {alias.pronunciation.source} · {alias.occurrences.length} occurrence
                  {alias.occurrences.length === 1 ? '' : 's'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {entity.category === 'Character' && entity.personality_notes.length > 0 && (
        <div>
          <div className="label mb-1">Personality</div>
          <p className="text-sm">{entity.personality_notes.map((note) => note.text).join(' ')}</p>
        </div>
      )}
      {entity.context && (
        <div>
          <div className="label mb-1">Context</div>
          <p className="text-sm">{entity.context}</p>
        </div>
      )}
      <div>
        <div className="label mb-1">Relationships</div>
        {entity.relationships.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
            None.
          </p>
        ) : (
          <p className="text-sm">{entity.relationships.map((rel) => `${rel.label} ${rel.name}`).join(' · ')}</p>
        )}
      </div>
      <div className="border-t pt-3" style={{ borderColor: 'var(--border)' }}>
        <div className="label mb-1">
          Evidence{' '}
          <span className="f-mono text-xs" style={{ color: 'var(--text-faint)' }}>
            ({evidence.length} shown)
          </span>
        </div>
        {evidence.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
            No occurrences found yet.
          </p>
        ) : (
          evidence.map((item, index) => (
            <div key={index} className="flex items-center justify-between gap-2 border-b py-2 last:border-0" style={{ borderColor: 'var(--border)' }}>
              <div className="min-w-0 flex-1">
                <span className="f-mono text-xs" style={{ color: 'var(--text-faint)' }}>
                  {item.chapter}
                  {item.alias ? (
                    <>
                      {' '}
                      · <span className="alias-term">alias: {item.alias}</span>
                    </>
                  ) : null}
                </span>
                <p className="mt-0.5 break-words text-sm">
                  {highlightTerms(item.excerpt, [entity.canonical_name, ...entity.aliases.map((alias) => alias.text)]).map((segment, piece) =>
                    segment.match ? (
                      <mark key={piece} className={`ms-highlight hl-${entity.category}`}>
                        {segment.text}
                      </mark>
                    ) : (
                      <span key={piece}>{segment.text}</span>
                    ),
                  )}
                </p>
              </div>
              <TooltipTarget text="Go to this line in Manuscript">
                <button className="icon-btn flex-none" aria-label="Go to line in Manuscript" onClick={() => jumpToLine(item.chapter, item.paragraph)}>
                  <FontAwesomeIcon icon={faFileLines} />
                </button>
              </TooltipTarget>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileLines, faLock } from '@fortawesome/free-solid-svg-icons';
import type { CSSProperties } from 'react';
import type { GuideEntity } from '../../types';
import { allEvidence, categoryLabel, highlightTerms } from '../../state';
import { Highlight, highlightKind } from '../primitives/Highlight';
import { TooltipTarget } from '../primitives/Tooltip';
import { IconButton } from '../primitives/IconButton';

export const BADGE_STYLE: Record<string, CSSProperties> = {
  Character: { background: 'var(--character-soft)', color: 'var(--character-text)' },
  Place: { background: 'var(--place-soft)', color: 'var(--place-text)' },
  Organization: { background: 'var(--org-soft)', color: 'var(--org-text)' },
  Review: { background: 'var(--review-soft)', color: 'var(--review-text)' },
  Lore: { background: 'color-mix(in srgb, var(--lore) 18%, var(--surface))', color: 'var(--lore-text)' },
  Item: { background: 'color-mix(in srgb, var(--item) 18%, var(--surface))', color: 'var(--item-text)' },
  Event: { background: 'color-mix(in srgb, var(--event) 18%, var(--surface))', color: 'var(--event-text)' },
};
export const BADGE_CLASS =
  "inline-flex items-center gap-[0.35rem] rounded-full px-[0.55rem] py-[0.15rem] font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold uppercase tracking-[0.03em]";

export const CAT_DOT_BG: Record<string, string> = {
  Character: 'var(--character)',
  Place: 'var(--place)',
  Organization: 'var(--org)',
  Review: 'var(--review)',
  Draft: 'var(--review)',
  Lore: 'var(--lore)',
  Item: 'var(--item)',
  Event: 'var(--event)',
  Note: 'var(--note)',
};
export const CAT_DOT_CLASS = 'size-2 flex-none rounded-full';

// A read-only mirror of the Story Bible's own detail panel (GuideDetail),
// for previewing an entity from the Manuscript without leaving the reader.
// Editing (name, aliases, relationships, lock/delete) stays exclusive to
// Story Bible - "Open in Story Bible" is the way in for that. Without `jumpToLine` the evidence has no "Go to line"
// buttons: the read-aloud rail (teleprompter-manuscript-integration.prd.md Phase 5) shows the entry beside the text being
// read, where leaving for another line would abandon the reading.
export function EntitySummary({ entity, jumpToLine }: { entity: GuideEntity; jumpToLine?: (chapter: string, paragraph: number) => void }) {
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
        <span className={BADGE_CLASS} style={BADGE_STYLE[entity.category]}>
          {categoryLabel(entity.category)}
        </span>
        <span className={BADGE_CLASS} style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
          {entity.review_state}
        </span>
        <span className="font-['IBM_Plex_Mono',ui-monospace,monospace] text-xs" style={{ color: 'var(--text-muted)' }}>
          {entity.occurrence_count} occurrences
        </span>
      </div>
      <div>
        <div className="mb-1 text-[0.82rem] font-medium text-[var(--text-muted)]">Pronunciation</div>
        <p className="font-['IBM_Plex_Mono',ui-monospace,monospace] text-sm">{entity.pronunciation.ipa || 'Not generated'}</p>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          Source: {entity.pronunciation.source} · Confidence: {entity.pronunciation.confidence}
        </p>
      </div>
      {entity.description.text && (
        <div>
          <div className="mb-1 text-[0.82rem] font-medium text-[var(--text-muted)]">Description</div>
          <p className="text-sm">{entity.description.text}</p>
        </div>
      )}
      {entity.properties.length > 0 && (
        <div>
          <div className="mb-1 text-[0.82rem] font-medium text-[var(--text-muted)]">Properties</div>
          <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
            {entity.properties.map((property) => (
              <div key={property.key} className="contents">
                <dt className="font-medium break-words">{property.key}</dt>
                <dd className="break-words whitespace-pre-wrap">{property.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <div>
        <div className="mb-1.5 text-[0.82rem] font-medium text-[var(--text-muted)]">Aliases</div>
        {entity.aliases.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            None.
          </p>
        ) : (
          <div className="space-y-2">
            {entity.aliases.map((alias) => (
              <div key={alias.text} className="rounded border px-2 py-1.5" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
                <div className="font-['IBM_Plex_Mono',ui-monospace,monospace] text-sm">{alias.text}</div>
                <div className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
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
          <div className="mb-1 text-[0.82rem] font-medium text-[var(--text-muted)]">Personality</div>
          <p className="text-sm">{entity.personality_notes.map((note) => note.text).join(' ')}</p>
        </div>
      )}
      {entity.context && (
        <div>
          <div className="mb-1 text-[0.82rem] font-medium text-[var(--text-muted)]">Context</div>
          <p className="text-sm">{entity.context}</p>
        </div>
      )}
      <div>
        <div className="mb-1 text-[0.82rem] font-medium text-[var(--text-muted)]">Relationships</div>
        {entity.relationships.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            None.
          </p>
        ) : (
          <p className="text-sm">{entity.relationships.map((rel) => `${rel.label} ${rel.name}`).join(' · ')}</p>
        )}
      </div>
      <div className="border-t pt-3" style={{ borderColor: 'var(--border)' }}>
        <div className="mb-1 text-[0.82rem] font-medium text-[var(--text-muted)]">
          Evidence{' '}
          <span className="font-['IBM_Plex_Mono',ui-monospace,monospace] text-xs" style={{ color: 'var(--text-muted)' }}>
            ({evidence.length} shown)
          </span>
        </div>
        {evidence.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            No occurrences found yet.
          </p>
        ) : (
          evidence.map((item, index) => (
            <div key={index} className="flex items-center justify-between gap-2 border-b py-2 last:border-0" style={{ borderColor: 'var(--border)' }}>
              <div className="min-w-0 flex-1">
                <span className="font-['IBM_Plex_Mono',ui-monospace,monospace] text-xs" style={{ color: 'var(--text-muted)' }}>
                  {item.chapter}
                  {item.alias ? (
                    <>
                      {' '}
                      · <span className="font-['IBM_Plex_Mono',monospace] text-[var(--accent-strong)]">alias: {item.alias}</span>
                    </>
                  ) : null}
                </span>
                <p className="mt-0.5 text-sm break-words">
                  {highlightTerms(item.excerpt, [entity.canonical_name, ...entity.aliases.map((alias) => alias.text)]).map((segment, piece) =>
                    segment.match ? (
                      <Highlight key={piece} kind={highlightKind(entity.category)}>
                        {segment.text}
                      </Highlight>
                    ) : (
                      <span key={piece}>{segment.text}</span>
                    ),
                  )}
                </p>
              </div>
              {jumpToLine && (
                <TooltipTarget text="Go to this line in Manuscript">
                  <IconButton label="Go to line in Manuscript" onClick={() => jumpToLine(item.chapter, item.paragraph)} className="flex-none">
                    <FontAwesomeIcon icon={faFileLines} />
                  </IconButton>
                </TooltipTarget>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

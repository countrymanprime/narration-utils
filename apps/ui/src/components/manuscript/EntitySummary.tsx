import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileLines, faLock } from '@fortawesome/free-solid-svg-icons';
import type { GuideEntity } from '../../types';
import { allEvidence, categoryLabel, highlightTerms } from '../../state';
import { Highlight, highlightKind } from '../primitives/Highlight';
import { TooltipTarget } from '../primitives/Tooltip';
import { IconButton } from '../primitives/IconButton';
import { Badge, StatusBadge, toneColors, type BadgeColors } from '../primitives/StatusBadge';
import { pronunciationSourceLabel } from '../storybible/pronunciationStatus';

// An entity kind's badge colours: the kind's soft fill (an 18% mix into the surface for the three kinds with no soft
// token) under its derived text colour (ADR 0059), drawn by THE badge (StatusBadge.tsx's `Badge`, ADR 0600).
const kindColors = (kind: string, fill: string): BadgeColors => ({ fill, text: `var(--${kind}-text)`, line: `var(--${kind})` });
export const ENTITY_BADGE_COLORS: Record<string, BadgeColors> = {
  Character: kindColors('character', 'var(--character-soft)'),
  Place: kindColors('place', 'var(--place-soft)'),
  Organization: kindColors('org', 'var(--org-soft)'),
  Review: kindColors('review', 'var(--review-soft)'),
  Lore: kindColors('lore', 'color-mix(in srgb, var(--lore) 18%, var(--surface))'),
  Item: kindColors('item', 'color-mix(in srgb, var(--item) 18%, var(--surface))'),
  Event: kindColors('event', 'color-mix(in srgb, var(--event) 18%, var(--surface))'),
};
/** A kind's badge colours, and the neutral pill's for a category with no kind colour of its own (a draft, a note). */
export const entityBadgeColors = (category: string): BadgeColors => ENTITY_BADGE_COLORS[category] ?? toneColors('neutral');

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
        <Badge label={categoryLabel(entity.category)} colors={entityBadgeColors(entity.category)} />
        <StatusBadge tone="neutral" label={entity.review_state} />
        <span className="font-['IBM_Plex_Mono',ui-monospace,monospace] text-xs" style={{ color: 'var(--text-muted)' }}>
          {entity.occurrence_count} occurrences
        </span>
      </div>
      <div>
        <div className="mb-1 text-[0.82rem] font-medium text-[var(--text-muted)]">Pronunciation</div>
        <p className="font-['IBM_Plex_Mono',ui-monospace,monospace] text-sm">{entity.pronunciation.ipa || 'Not generated'}</p>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          Source: {pronunciationSourceLabel(entity.pronunciation)} · Confidence: {entity.pronunciation.confidence}
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
                  {alias.pronunciation.ipa || 'Not generated'} · {pronunciationSourceLabel(alias.pronunciation)} · {alias.occurrences.length} occurrence
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
                <TooltipTarget text="Go to this line in Script">
                  <IconButton label="Go to line in Script" onClick={() => jumpToLine(item.chapter, item.paragraph)} className="flex-none">
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

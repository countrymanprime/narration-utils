import { describeApiError } from '../../api/errorMessage';
import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faChevronDown,
  faCodeMerge,
  faFileLines,
  faFloppyDisk,
  faLock,
  faLockOpen,
  faPause,
  faPen,
  faPlus,
  faRotate,
  faTrash,
  faWaveSquare,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import type { GuideEntity, GuidePreview, TtsInstallJob } from '../../types';
import { allEvidence, categoryCssName, categoryLabel, categoryValue, CREATABLE_CATEGORIES, findAliasMatches, highlightTerms } from '../../state';
import { useApi } from '../../api/ApiContext';
import { BADGE_CLASS, BADGE_STYLE, CAT_DOT_BG, CAT_DOT_CLASS, EntitySummary } from '../manuscript/EntitySummary';
import { Highlight, highlightKind } from '../primitives/Highlight';
import { SlideOver } from '../primitives/SlideOver';
import { Button } from '../primitives/Button';
import { Field } from '../primitives/Field';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { Menu } from '../primitives/Menu';
import { Tooltip, TooltipTarget } from '../primitives/Tooltip';
import { CANONICAL_PREVIEW, previewKey, usePreviewAudio } from './usePreviewAudio';
import { IconButton } from '../primitives/IconButton';
import { Select } from '../primitives/Select';
import { TextField } from '../primitives/TextField';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/Table';

export function GuideDetail({
  entity,
  isNewDraft = false,
  onDiscardNewDraft,
  onCreatedNewDraft,
  entities,
  reload,
  notify,
  goToManuscript,
}: {
  entity?: GuideEntity;
  // A brand-new entity with no backend record yet - see Guide.tsx's
  // pendingNewEntity/emptyGuideEntity. Nothing is written until a category
  // is chosen, so navigating away just discards it instead of orphaning a
  // "Draft"-category record the way an immediate create-on-click used to.
  isNewDraft?: boolean;
  onDiscardNewDraft?: () => void;
  onCreatedNewDraft?: (id: string) => void;
  entities: GuideEntity[];
  reload: (selectId?: string) => Promise<void>;
  notify: (text: string) => void;
  goToManuscript: (chapter: string, paragraph: number) => void;
}) {
  const api = useApi();
  const [draft, setDraft] = useState({ name: '', description: '', personality: '', context: '' });
  const [editing, setEditing] = useState(false);
  const [aliasQuery, setAliasQuery] = useState('');
  const [aliasSelectedId, setAliasSelectedId] = useState<string>();
  const [aliasActiveIndex, setAliasActiveIndex] = useState(0);
  const [relationOtherId, setRelationOtherId] = useState('');
  const [relationLabel, setRelationLabel] = useState('');
  const [confirmation, setConfirmation] = useState<'delete' | 'merge'>();
  // A slide-over, not select(id), so opening an alias match to review it
  // never resets the in-progress draft of the entry the user was already
  // editing - see the "Review entry" button below.
  const [reviewOverlayId, setReviewOverlayId] = useState<string>();
  const [ttsPrompt, setTtsPrompt] = useState<{ preview: Extract<GuidePreview, { status: 'asset_required' }>; aliasIndex?: number }>();
  const [ttsJob, setTtsJob] = useState<TtsInstallJob>();
  const { playingPreview, playPreview } = usePreviewAudio({
    resetKey: entity,
    requestPreview: (aliasIndex) => {
      if (!entity) throw new Error('Select a Story Bible entry before previewing it.');
      return api.guidePreview(entity.id, aliasIndex);
    },
    onAssetRequired: (preview, aliasIndex) => {
      setTtsJob(undefined);
      setTtsPrompt({ preview, aliasIndex });
    },
    notify,
  });

  // Selecting a different entry always starts read-only; a reload of the same
  // entry (after Save, an alias change, ...) keeps its mode.
  useEffect(() => setEditing(false), [entity?.id]);
  useEffect(() => {
    setAliasQuery('');
    setAliasSelectedId(undefined);
    setAliasActiveIndex(0);
    setTtsPrompt(undefined);
    setTtsJob(undefined);
    if (entity)
      setDraft({
        name: entity.canonical_name,
        description: entity.description.text,
        personality: entity.personality_notes.map((note) => note.text).join(' '),
        context: entity.context || '',
      });
  }, [entity]);

  if (!entity)
    return (
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-[1.1rem] shadow-[var(--shadow)]">
        No matching entities. Build the guide to discover names and terms.
      </section>
    );
  const locked = entity.locked;
  // Entries open read-only (ADR-0018): Edit reveals the form controls and Save.
  // A locked entry cannot be edited at all, and a brand-new draft is created by
  // choosing its category rather than through the edit form.
  const canEdit = !locked && !isNewDraft;
  const editingDisabled = !canEdit || !editing;
  const stopEditing = () => {
    setEditing(false);
    setDraft({
      name: entity.canonical_name,
      description: entity.description.text,
      personality: entity.personality_notes.map((note) => note.text).join(' '),
      context: entity.context || '',
    });
  };
  const otherEntities = entities.filter((row) => row.id !== entity.id && row.category !== 'Draft');
  const aliasMatches = aliasSelectedId ? [] : findAliasMatches(entities, aliasQuery, entity.id);
  const selectedAliasMatch = aliasSelectedId ? entities.find((row) => row.id === aliasSelectedId) : undefined;
  const reviewOverlayEntity = reviewOverlayId ? entities.find((row) => row.id === reviewOverlayId) : undefined;
  const evidence = allEvidence(entity);
  const highlightNames = [entity.canonical_name, ...entity.aliases.map((alias) => alias.text)];

  const save = async (values: Record<string, string>, message: string): Promise<boolean> => {
    try {
      await api.guideEdit(entity.id, values);
      notify(message);
      await reload(entity.id);
      return true;
    } catch (error) {
      notify(describeApiError(error));
      return false;
    }
  };
  const setAliasTexts = (aliases: string[]) => save({ aliases: aliases.join(';') }, 'Aliases updated.');
  const clearAliasMatch = () => {
    setAliasQuery('');
    setAliasSelectedId(undefined);
    setAliasActiveIndex(0);
  };
  const addAliasFromQuery = () => {
    const value = aliasQuery.trim();
    if (!value) return;
    clearAliasMatch();
    void setAliasTexts([...entity.aliases.map((alias) => alias.text), value]);
  };
  const installPreviewVoice = async () => {
    if (!ttsPrompt || ttsJob?.phase === 'downloading') return;
    try {
      let job = await api.ttsInstall(ttsPrompt.preview.voice.id);
      setTtsJob(job);
      while (job.id && job.phase === 'downloading') {
        await new Promise((resolve) => window.setTimeout(resolve, 400));
        job = await api.ttsInstallState(job.id);
        setTtsJob(job);
      }
      if (job.phase === 'success') {
        const aliasIndex = ttsPrompt.aliasIndex;
        setTtsPrompt(undefined);
        setTtsJob(undefined);
        notify('Preview voice installed.');
        await playPreview(aliasIndex);
      } else if (job.phase !== 'cancelled') notify(job.error || job.message);
    } catch (error) {
      notify(describeApiError(error));
    }
  };
  const cancelVoiceInstall = async () => {
    if (ttsJob?.id && ttsJob.phase === 'downloading') {
      try {
        setTtsJob(await api.ttsInstallCancel(ttsJob.id));
      } catch (error) {
        notify(describeApiError(error));
      }
      return;
    }
    setTtsPrompt(undefined);
    setTtsJob(undefined);
  };
  const createNewEntity = async (category: string) => {
    try {
      const id = await api.guideCreate(draft.name.trim() || entity.canonical_name, category, []);
      notify('Entity created.');
      onCreatedNewDraft?.(id);
    } catch (error) {
      notify(describeApiError(error));
    }
  };
  const rescanOccurrences = async () => {
    try {
      await api.guideRescan(entity.id);
      notify('Occurrences rescanned.');
      await reload(entity.id);
    } catch (error) {
      notify(describeApiError(error));
    }
  };
  const onAliasKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      clearAliasMatch();
      return;
    }
    if (!aliasSelectedId && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      if (!aliasMatches.length) return;
      event.preventDefault();
      setAliasActiveIndex((current) => (current + (event.key === 'ArrowDown' ? 1 : -1) + aliasMatches.length) % aliasMatches.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!aliasSelectedId && aliasMatches.length > 0) setAliasSelectedId(aliasMatches[aliasActiveIndex].id);
      else if (!aliasSelectedId) addAliasFromQuery();
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-[1.1rem] py-[0.85rem]">
        <div className="flex min-w-0 items-center gap-2">
          <span className={CAT_DOT_CLASS} style={{ background: CAT_DOT_BG[categoryCssName(entity.category)] }} />
          <h2 className="truncate font-semibold">{entity.canonical_name || 'New entity'}</h2>
          <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            <div style={{ position: 'relative' }}>
              <Menu
                triggerClassName={BADGE_CLASS}
                triggerStyle={BADGE_STYLE[entity.category]}
                disabled={locked || !(editing || isNewDraft)}
                items={CREATABLE_CATEGORIES.map((label) => ({
                  key: label,
                  label,
                  leading: <span className={CAT_DOT_CLASS} style={{ background: CAT_DOT_BG[categoryValue(label)] }} />,
                  onSelect: () => {
                    if (isNewDraft) void createNewEntity(categoryValue(label));
                    else void save({ category: categoryValue(label) }, `Category changed to ${label}.`);
                  },
                }))}
              >
                {categoryLabel(entity.category)} <FontAwesomeIcon icon={faChevronDown} />
              </Menu>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="mr-1 font-['IBM_Plex_Mono',ui-monospace,monospace] text-xs" style={{ color: 'var(--text-muted)' }}>
            {entity.occurrence_count} occurrences
          </span>
          {!isNewDraft && (
            <TooltipTarget text={locked ? 'Unlock entry' : 'Lock entry'}>
              <IconButton
                label={locked ? 'Unlock entry' : 'Lock entry'}
                onClick={async () => {
                  try {
                    await api.guideSetLocked(entity.id, !locked);
                    notify(locked ? 'Entry unlocked.' : 'Entry locked.');
                    await reload(entity.id);
                  } catch (error) {
                    notify(describeApiError(error));
                  }
                }}
              >
                <FontAwesomeIcon icon={locked ? faLock : faLockOpen} />
              </IconButton>
            </TooltipTarget>
          )}
          {canEdit && !editing && (
            <TooltipTarget text="Edit this entry">
              <IconButton label="Edit this entry" onClick={() => setEditing(true)}>
                <FontAwesomeIcon icon={faPen} />
              </IconButton>
            </TooltipTarget>
          )}
          {canEdit && editing && (
            <>
              <TooltipTarget text="Save changes to this entry">
                <IconButton
                  label="Save changes to this entry"
                  onClick={() =>
                    void save(
                      {
                        canonical_name: draft.name.trim() || entity.canonical_name,
                        description: draft.description,
                        personality: draft.personality,
                        context: draft.context,
                      },
                      'Entry saved.',
                    ).then((saved) => saved && setEditing(false))
                  }
                  variant="primary"
                >
                  <FontAwesomeIcon icon={faFloppyDisk} />
                </IconButton>
              </TooltipTarget>
              <TooltipTarget text="Discard changes and stop editing">
                <IconButton label="Cancel editing" onClick={stopEditing}>
                  <FontAwesomeIcon icon={faXmark} />
                </IconButton>
              </TooltipTarget>
            </>
          )}
          {!locked && !isNewDraft && (
            <TooltipTarget text="Delete entity">
              <IconButton label="Delete entity" onClick={() => setConfirmation('delete')}>
                <FontAwesomeIcon icon={faTrash} />
              </IconButton>
            </TooltipTarget>
          )}
          {isNewDraft && (
            <TooltipTarget text="Discard this new entry">
              <IconButton label="Discard this new entry" onClick={() => onDiscardNewDraft?.()}>
                <FontAwesomeIcon icon={faXmark} />
              </IconButton>
            </TooltipTarget>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-[1.1rem]">
        {locked && (
          <p className="rounded px-3 py-1.5 text-xs" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
            <FontAwesomeIcon icon={faLock} className="mr-1.5" />
            Locked entries cannot be deleted or used as merge sources.
          </p>
        )}
        {entity.category === 'Draft' && (
          <p className="rounded px-3 py-1.5 text-xs" style={{ background: 'var(--accent-soft)', color: 'var(--accent-strong)' }}>
            Choose a category above to finish setting up this entry.
          </p>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1.5 text-[0.82rem] font-medium text-[var(--text-muted)]">Name</div>
            <TextField label="Name" disabled={editingDisabled} value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
          </div>
          <div>
            <div className="mb-1.5 text-[0.82rem] font-medium text-[var(--text-muted)]">
              Pronunciation
              <Tooltip text="Generated pronunciation; the waveform button plays an audio preview." />
            </div>
            <div style={{ position: 'relative', width: '100%' }}>
              <div
                className="min-h-[var(--control-height)] w-full cursor-default rounded-[var(--control-radius)] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-[0.6rem] font-['IBM_Plex_Mono',ui-monospace,monospace] text-[0.88rem] leading-[1.35] text-[var(--text)]"
                style={{ paddingRight: '2.75rem' }}
              >
                {entity.pronunciation.ipa || 'Not generated'}
              </div>
              <TooltipTarget
                text={playingPreview === CANONICAL_PREVIEW ? 'Pause pronunciation preview' : 'Play provider-generated pronunciation'}
                style={{ position: 'absolute', right: '.25rem', top: '50%', transform: 'translateY(-50%)' }}
              >
                <IconButton
                  label={playingPreview === CANONICAL_PREVIEW ? 'Pause preview' : 'Play preview'}
                  disabled={isNewDraft}
                  onClick={() => void playPreview()}
                >
                  <FontAwesomeIcon icon={playingPreview === CANONICAL_PREVIEW ? faPause : faWaveSquare} />
                </IconButton>
              </TooltipTarget>
            </div>
            <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
              Source: {entity.pronunciation.source} · Confidence: {entity.pronunciation.confidence}
            </p>
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-[0.82rem] font-medium text-[var(--text-muted)]">Aliases</div>
          <Table label="Aliases">
            <TableHead>
              <TableRow>
                <TableHeader>Alias</TableHeader>
                <TableHeader style={{ minWidth: '9rem' }}>Pronunciation</TableHeader>
                <TableHeader>Occurrences</TableHeader>
                <TableHeader hiddenLabel="Actions" />
              </TableRow>
            </TableHead>
            <TableBody>
              {entity.aliases.map((alias, index) => (
                <TableRow key={alias.text}>
                  <TableCell className="font-['IBM_Plex_Mono',ui-monospace,monospace] text-sm">{alias.text}</TableCell>
                  <TableCell>
                    <div style={{ position: 'relative', width: '100%' }}>
                      <div
                        className="min-h-[var(--control-height)] w-full cursor-default rounded-[var(--control-radius)] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-[0.6rem] font-['IBM_Plex_Mono',ui-monospace,monospace] text-xs leading-[1.35] text-[var(--text)]"
                        style={{ paddingRight: '2.75rem' }}
                      >
                        {alias.pronunciation.ipa || 'Not generated'}
                      </div>
                      <TooltipTarget
                        text={playingPreview === previewKey(index) ? 'Pause alias pronunciation preview' : 'Play this alias pronunciation'}
                        style={{ position: 'absolute', right: '.25rem', top: '50%', transform: 'translateY(-50%)' }}
                      >
                        <IconButton
                          label={playingPreview === previewKey(index) ? 'Pause alias pronunciation' : 'Play alias pronunciation'}
                          onClick={() => void playPreview(index)}
                        >
                          <FontAwesomeIcon icon={playingPreview === previewKey(index) ? faPause : faWaveSquare} />
                        </IconButton>
                      </TooltipTarget>
                    </div>
                  </TableCell>
                  <TableCell className="font-['IBM_Plex_Mono',ui-monospace,monospace]">{alias.occurrences.length}</TableCell>
                  <TableCell align="right">
                    <IconButton
                      label={`Remove alias ${alias.text}`}
                      disabled={editingDisabled}
                      onClick={() => void setAliasTexts(entity.aliases.filter((other) => other.text !== alias.text).map((other) => other.text))}
                    >
                      <FontAwesomeIcon icon={faXmark} />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-3">
            <TextField
              label="Add an alias or find a matching entry"
              role="combobox"
              aria-expanded={aliasMatches.length > 0}
              disabled={editingDisabled}
              value={aliasQuery}
              onChange={(value) => {
                setAliasQuery(value);
                setAliasSelectedId(undefined);
                setAliasActiveIndex(0);
              }}
              onKeyDown={onAliasKeyDown}
              placeholder="Add an alias or find a matching entry…"
            />
            {selectedAliasMatch ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Selected match: <strong>{selectedAliasMatch.canonical_name}</strong>
                  {selectedAliasMatch.locked ? ' · locked' : ''}
                </span>
                <Button variant="ghost" className="text-xs" onClick={() => setReviewOverlayId(selectedAliasMatch.id)}>
                  Review entry
                </Button>
                {selectedAliasMatch.locked ? (
                  <TooltipTarget text="Locked entries cannot be merged because the source would be deleted.">
                    <Button variant="primary" className="text-xs" disabled>
                      Merge into current entry
                    </Button>
                  </TooltipTarget>
                ) : (
                  <Button variant="primary" className="text-xs" onClick={() => setConfirmation('merge')}>
                    <FontAwesomeIcon icon={faCodeMerge} />
                    Merge into current entry
                  </Button>
                )}
                <Button variant="ghost" className="text-xs" onClick={clearAliasMatch}>
                  Clear selection
                </Button>
              </div>
            ) : aliasQuery ? (
              <div
                className="mt-1 flex flex-col overflow-hidden rounded-[var(--control-radius)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)]"
                role="listbox"
                aria-label="Matching Story Bible entries"
              >
                {aliasMatches.length > 0 ? (
                  aliasMatches.map((match, index) => (
                    <button
                      key={match.id}
                      type="button"
                      role="option"
                      aria-selected={index === aliasActiveIndex}
                      className={`flex w-full items-center gap-2 border-b border-[var(--border)] px-3 py-2 text-left hover:bg-[var(--surface-2)] ${index === aliasActiveIndex ? 'bg-[var(--surface-2)]' : ''}`}
                      onClick={() => setAliasSelectedId(match.id)}
                    >
                      <span className={CAT_DOT_CLASS} style={{ background: CAT_DOT_BG[categoryCssName(match.category)] }} />
                      <span className="min-w-0 flex-1">
                        <strong className="text-sm">{match.canonical_name}</strong>
                        <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
                          {categoryLabel(match.category)} · {match.occurrence_count} occurrence{match.occurrence_count === 1 ? '' : 's'}
                        </span>
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="p-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                    No matching Story Bible entries.
                  </div>
                )}
                <div data-alias-actions className="flex items-center justify-between p-2">
                  <TooltipTarget text="Add alias">
                    <IconButton label="Add alias" disabled={editingDisabled} onClick={addAliasFromQuery}>
                      <FontAwesomeIcon icon={faPlus} />
                    </IconButton>
                  </TooltipTarget>
                  <TooltipTarget text="Rescan occurrences for this entry">
                    <IconButton label="Rescan occurrences" disabled={isNewDraft} onClick={() => void rescanOccurrences()}>
                      <FontAwesomeIcon icon={faRotate} />
                    </IconButton>
                  </TooltipTarget>
                </div>
              </div>
            ) : (
              <div data-alias-actions className="mt-2 flex items-center justify-between">
                <TooltipTarget text="Add alias">
                  <IconButton label="Add alias" disabled={editingDisabled} onClick={addAliasFromQuery}>
                    <FontAwesomeIcon icon={faPlus} />
                  </IconButton>
                </TooltipTarget>
                <TooltipTarget text="Rescan occurrences for this entry">
                  <IconButton label="Rescan occurrences" disabled={isNewDraft} onClick={() => void rescanOccurrences()}>
                    <FontAwesomeIcon icon={faRotate} />
                  </IconButton>
                </TooltipTarget>
              </div>
            )}
          </div>
        </div>

        <Field
          label="Description"
          textarea
          disabled={editingDisabled}
          value={draft.description}
          onChange={(value) => setDraft({ ...draft, description: value })}
        />

        {entity.category === 'Character' && (
          <>
            <Field
              label="Personality notes"
              textarea
              disabled={editingDisabled}
              value={draft.personality}
              onChange={(value) => setDraft({ ...draft, personality: value })}
            />
            <div>
              <div className="mb-1.5 text-[0.82rem] font-medium text-[var(--text-muted)]">Voice samples</div>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                No samples yet.
              </p>
              <Button
                variant="ghost"
                className="mt-1.5 text-xs"
                disabled={editingDisabled}
                onClick={() => notify('Voice-sample picker is a future integration.')}
              >
                + Add sample
              </Button>
            </div>
          </>
        )}
        {entity.category === 'Place' && (
          <Field
            label="Location context"
            textarea
            disabled={editingDisabled}
            value={draft.context}
            onChange={(value) => setDraft({ ...draft, context: value })}
          />
        )}
        {entity.category === 'Event' && (
          <Field label="Timeline context" disabled={editingDisabled} value={draft.context} onChange={(value) => setDraft({ ...draft, context: value })} />
        )}
        {entity.category === 'Item' && (
          <Field label="Item context" textarea disabled={editingDisabled} value={draft.context} onChange={(value) => setDraft({ ...draft, context: value })} />
        )}
        {entity.category === 'Lore' && (
          <Field label="Lore context" textarea disabled={editingDisabled} value={draft.context} onChange={(value) => setDraft({ ...draft, context: value })} />
        )}

        <div className="border-t pt-4" style={{ borderColor: 'var(--border)' }}>
          <div className="mb-2 text-[0.82rem] font-medium text-[var(--text-muted)]">Relationships</div>
          <Table label="Relationships">
            <TableHead>
              <TableRow>
                <TableHeader>Relationship</TableHeader>
                <TableHeader>Entry</TableHeader>
                <TableHeader hiddenLabel="Remove" />
              </TableRow>
            </TableHead>
            <TableBody>
              {entity.relationships.map((rel) => (
                <TableRow key={`${rel.id}-${rel.label}`}>
                  <TableCell>{rel.label}</TableCell>
                  <TableCell>{rel.name}</TableCell>
                  <TableCell align="right">
                    <IconButton
                      label="Remove relationship"
                      disabled={editingDisabled}
                      onClick={async () => {
                        try {
                          await api.guideUnrelate(entity.id, rel.id, rel.label);
                          await reload(entity.id);
                        } catch (error) {
                          notify(describeApiError(error));
                        }
                      }}
                    >
                      <FontAwesomeIcon icon={faXmark} />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {entity.relationships.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    No related entries yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: '1fr 1fr auto' }}>
            <TextField
              label="Relationship"
              disabled={editingDisabled}
              value={relationLabel}
              onChange={setRelationLabel}
              placeholder="Relationship, e.g. located in"
            />
            <Select
              label="Related entry"
              fullWidth
              disabled={editingDisabled}
              value={relationOtherId}
              onChange={setRelationOtherId}
              options={[{ value: '', label: 'Choose entry…' }, ...otherEntities.map((row) => ({ value: row.id, label: row.canonical_name }))]}
            />
            <Button
              variant="ghost"
              className="text-xs"
              disabled={editingDisabled}
              onClick={async () => {
                if (!relationOtherId || !relationLabel.trim()) return;
                try {
                  await api.guideRelate(entity.id, relationOtherId, relationLabel.trim());
                  setRelationOtherId('');
                  setRelationLabel('');
                  await reload(entity.id);
                } catch (error) {
                  notify(describeApiError(error));
                }
              }}
            >
              <FontAwesomeIcon icon={faPlus} /> Add
            </Button>
          </div>
        </div>

        <div className="border-t pt-4" style={{ borderColor: 'var(--border)' }}>
          <div className="mb-1.5 text-[0.82rem] font-medium text-[var(--text-muted)]">
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
              <div key={index} className="flex items-center justify-between gap-3 border-b py-3 last:border-0" style={{ borderColor: 'var(--border)' }}>
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
                  <p className="mt-1 text-sm break-words">
                    {highlightTerms(item.excerpt, highlightNames).map((segment, i) =>
                      segment.match ? (
                        <Highlight key={i} kind={highlightKind(entity.category)}>
                          {segment.text}
                        </Highlight>
                      ) : (
                        <span key={i}>{segment.text}</span>
                      ),
                    )}
                  </p>
                </div>
                <TooltipTarget text="Open this evidence in Manuscript">
                  <Button variant="ghost" className="flex-none text-xs" onClick={() => goToManuscript(item.chapter, item.paragraph)}>
                    <FontAwesomeIcon icon={faFileLines} />
                    Go to line
                  </Button>
                </TooltipTarget>
              </div>
            ))
          )}
        </div>
        {ttsPrompt && (
          <ConfirmDialog
            title={ttsJob?.phase === 'downloading' ? 'Downloading preview voice' : 'Download local preview voice?'}
            body={
              ttsJob?.phase === 'downloading'
                ? ttsJob.message
                : `This local voice is needed to play “${ttsPrompt.aliasIndex === undefined ? entity.canonical_name : (entity.aliases[ttsPrompt.aliasIndex]?.text ?? 'this alias')}”. It is not bundled with Narration Utils and will be stored in your per-user asset cache.`
            }
            confirmLabel={ttsJob?.phase === 'downloading' ? 'Downloading…' : 'Download voice'}
            confirm={() => void installPreviewVoice()}
            cancel={() => void cancelVoiceInstall()}
            escapeCancels={ttsJob?.phase !== 'downloading'}
          >
            {ttsJob?.phase === 'downloading' && (
              <div className="progressbar mt-3 h-4 overflow-hidden rounded-full bg-[var(--surface-3)]">
                <div
                  className="h-full bg-[var(--accent)] transition-[width] duration-[0.4s] ease-in-out"
                  style={{ width: `${Math.max(ttsJob.percent, 4)}%` }}
                />
              </div>
            )}
            <dl className="mt-3 space-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>
              <div>
                <dt className="inline font-medium">Voice: </dt>
                <dd className="inline">
                  {ttsPrompt.preview.voice.displayName} · {ttsPrompt.preview.voice.locale}
                </dd>
              </div>
              <div>
                <dt className="inline font-medium">Download: </dt>
                <dd className="inline">
                  {Math.ceil(ttsPrompt.preview.downloadSize / (1024 * 1024))} MB · {ttsPrompt.preview.voice.publisher}
                </dd>
              </div>
              <div>
                <dt className="inline font-medium">License: </dt>
                <dd className="inline">
                  <a className="link" href={ttsPrompt.preview.voice.licenseUrl} target="_blank" rel="noreferrer">
                    {ttsPrompt.preview.voice.license}
                  </a>
                </dd>
              </div>
              <div>
                <a className="link" href={ttsPrompt.preview.voice.modelCardUrl} target="_blank" rel="noreferrer">
                  Model card
                </a>
                {' · '}
                <a className="link" href={ttsPrompt.preview.voice.provenanceUrl} target="_blank" rel="noreferrer">
                  Provenance
                </a>
              </div>
            </dl>
          </ConfirmDialog>
        )}
        {confirmation === 'delete' && (
          <ConfirmDialog
            title="Delete entry"
            body={`Delete “${entity.canonical_name}” and its aliases, evidence, and relationships? This cannot be undone.`}
            confirmLabel="Delete entry"
            confirmVariant="danger"
            confirm={() => {
              setConfirmation(undefined);
              void api
                .guideDelete(entity.id)
                .then(() => {
                  notify('Entity deleted.');
                  return reload();
                })
                .catch((error) => notify(describeApiError(error)));
            }}
            cancel={() => setConfirmation(undefined)}
          />
        )}
        {confirmation === 'merge' && selectedAliasMatch && (
          <ConfirmDialog
            title="Merge entries"
            body={`Merge “${selectedAliasMatch.canonical_name}” into “${entity.canonical_name}”? The source entry will be deleted.`}
            confirmLabel="Merge & delete source"
            confirmVariant="danger"
            confirm={() => {
              setConfirmation(undefined);
              void api
                .guideMerge(selectedAliasMatch.id, entity.id)
                .then(() => {
                  clearAliasMatch();
                  notify(`Merged ${selectedAliasMatch.canonical_name} into ${entity.canonical_name}.`);
                  return reload(entity.id);
                })
                .catch((error) => notify(describeApiError(error)));
            }}
            cancel={() => setConfirmation(undefined)}
          />
        )}
      </div>
      <SlideOver
        open={Boolean(reviewOverlayEntity)}
        title={reviewOverlayEntity?.canonical_name || 'Review entry'}
        closeLabel="Close review panel"
        onClose={() => setReviewOverlayId(undefined)}
      >
        {reviewOverlayEntity && <EntitySummary entity={reviewOverlayEntity} jumpToLine={goToManuscript} />}
      </SlideOver>
    </section>
  );
}

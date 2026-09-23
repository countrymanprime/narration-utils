import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiErrorMessage } from '../../api/errorMessage';
import { useApi } from '../../api/ApiContext';
import { previewParts } from '../../creditsPreviewParts';
import type { CreditsRenderResult, CreditTemplate, CreditValues } from '../../types';
import { Button } from '../primitives/Button';
import { Field } from '../primitives/Field';
import { Select } from '../primitives/Select';
import { Highlight } from '../primitives/Highlight';
import type { Notify } from '../primitives/Toast';

const KIND_LABEL: Record<string, string> = { opening: 'Opening', closing: 'Closing', chapter_announcement: 'Chapter announcement' };
const KIND_OPTIONS = [
  { value: 'opening', label: 'Opening' },
  { value: 'closing', label: 'Closing' },
];

/** The project's own credit token value fields (Open Questions C2/C4/C7): every one is optional and per-project except
 * `narrator`, which overrides the global narrator default only for this project. */
const VALUE_FIELDS: { key: keyof CreditValues; label: string; suggestionKey?: string }[] = [
  { key: 'title', label: 'Title', suggestionKey: 'Title' },
  { key: 'subtitle', label: 'Subtitle' },
  { key: 'author', label: 'Author', suggestionKey: 'Author' },
  { key: 'series', label: 'Series' },
  { key: 'bookNumber', label: 'Book number' },
  { key: 'copyright', label: 'Copyright' },
  { key: 'year', label: 'Year' },
  { key: 'copyrightHolder', label: 'Copyright holder' },
  { key: 'publisher', label: 'Publisher' },
  { key: 'narrator', label: 'Narrator (override the global default)' },
];

// previewParts (splitting an unresolved token out as its own chip marker) now lives in ../../creditsPreviewParts,
// shared with the Manuscript pseudo-entries (Phase 3) so both surfaces highlight an unresolved token the same way.

/**
 * Settings > Credits (PRD audiobook-credits-templates.prd.md, Phase 1): the narrator's template library (shipped
 * defaults plus their own, add/duplicate/edit/delete), this project's own credit values with suggestions seeded from
 * the manuscript, and a live preview rendered by the same Go renderer the estimate and the teleprompter will use in
 * later phases. Saving values never blocks on an unresolved token (C6); this panel only shows the count and chip.
 */
export function CreditsPanel({ notify }: { notify: Notify }) {
  const api = useApi();
  const [templates, setTemplates] = useState<CreditTemplate[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftKind, setDraftKind] = useState('opening');
  const [draftBody, setDraftBody] = useState('');
  const [templateDirty, setTemplateDirty] = useState(false);
  const [values, setValues] = useState<CreditValues>({});
  const [narratorGlobal, setNarratorGlobal] = useState('');
  const [suggestions, setSuggestions] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<CreditsRenderResult>();
  const [loadError, setLoadError] = useState('');
  // Guards a second click while a template action or a value save is in flight (ADR 0075): every button below that
  // starts one of these disables until it ends, and the field being saved disables too.
  const [busy, setBusy] = useState(false);
  const [savingKey, setSavingKey] = useState<keyof CreditValues>();

  const selected = templates.find((template) => template.id === selectedId);

  const load = useCallback(async () => {
    try {
      const [nextTemplates, projectValues] = await Promise.all([api.creditsTemplates(), api.creditsProjectValues()]);
      setTemplates(nextTemplates);
      setValues(projectValues.values);
      setNarratorGlobal(projectValues.narratorGlobal);
      setSuggestions(projectValues.suggestions);
      setLoadError('');
      setSelectedId((current) => {
        if (nextTemplates.some((template) => template.id === current)) return current;
        return nextTemplates[0]?.id ?? '';
      });
    } catch (error) {
      setLoadError(apiErrorMessage(error));
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selected) {
      setDraftName('');
      setDraftKind('opening');
      setDraftBody('');
      setTemplateDirty(false);
      return;
    }
    setDraftName(selected.name);
    setDraftKind(selected.kind);
    setDraftBody(selected.body);
    setTemplateDirty(false);
  }, [selected]);

  useEffect(() => {
    let active = true;
    api
      .creditsPreview(draftBody)
      .then((result) => active && setPreview(result))
      .catch(() => active && setPreview(undefined));
    return () => {
      active = false;
    };
  }, [api, draftBody, values]);

  const saveTemplate = async () => {
    setBusy(true);
    try {
      const saved = await api.saveCreditsTemplate(selected?.id ?? '', draftKind, draftName, draftBody);
      notify('Credit template saved.');
      await load();
      setSelectedId(saved.id);
    } catch (error) {
      notify(apiErrorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  };
  const newTemplate = () => {
    setSelectedId('');
    setDraftName('New template');
    setDraftKind('opening');
    setDraftBody('');
    setTemplateDirty(true);
  };
  const duplicateTemplate = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const duplicate = await api.duplicateCreditsTemplate(selected.id);
      notify(`Duplicated as "${duplicate.name}".`);
      await load();
      setSelectedId(duplicate.id);
    } catch (error) {
      notify(apiErrorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  };
  const deleteTemplate = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await api.deleteCreditsTemplate(selected.id);
      notify('Credit template deleted.');
      await load();
    } catch (error) {
      notify(apiErrorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveValue = async (key: keyof CreditValues, value: string) => {
    const next = { ...values, [key]: value };
    setValues(next);
    setSavingKey(key);
    try {
      await api.saveCreditsProjectValues(next);
    } catch (error) {
      notify(apiErrorMessage(error), 'error');
    } finally {
      setSavingKey((current) => (current === key ? undefined : current));
    }
  };
  const acceptSuggestion = (key: keyof CreditValues, suggestionKey: string) => {
    void saveValue(key, suggestions[suggestionKey] ?? '');
  };

  const parts = useMemo(() => (preview ? previewParts(preview) : []), [preview]);

  return (
    <div className="space-y-5 text-sm">
      {loadError && (
        <div className="rounded-md p-3 text-sm" role="alert" style={{ background: 'var(--review-soft)', color: 'var(--danger-text)' }}>
          Credits could not be loaded: {loadError}.
        </div>
      )}

      <section aria-labelledby="credits-templates-heading" className="space-y-3">
        <h3 id="credits-templates-heading" className="font-medium">
          Templates
        </h3>
        <div className="flex flex-wrap items-end gap-2">
          <Select
            label="Template"
            value={selectedId}
            onChange={setSelectedId}
            fullWidth
            options={templates.map((template) => ({ value: template.id, label: `${template.name} (${KIND_LABEL[template.kind] ?? template.kind})` }))}
          />
          <Button variant="ghost" type="button" disabled={busy} onClick={newTemplate}>
            New
          </Button>
          <Button variant="ghost" type="button" disabled={!selected || busy} pending={busy} onClick={() => void duplicateTemplate()}>
            Duplicate
          </Button>
          <Button variant="danger" type="button" disabled={!selected || busy} pending={busy} onClick={() => void deleteTemplate()}>
            Delete
          </Button>
        </div>
        <Field
          label="Name"
          value={draftName}
          onChange={(value) => {
            setDraftName(value);
            setTemplateDirty(true);
          }}
        />
        <div className="text-[0.82rem] font-medium text-[var(--text-muted)]">
          Kind
          <Select
            label="Kind"
            value={draftKind}
            onChange={(value) => {
              setDraftKind(value);
              setTemplateDirty(true);
            }}
            options={KIND_OPTIONS}
            fullWidth
          />
        </div>
        <Field
          label="Body"
          textarea
          value={draftBody}
          onChange={(value) => {
            setDraftBody(value);
            setTemplateDirty(true);
          }}
          hint="Bracketed tokens such as [Title], [Author] and [Narrator] are filled from the project values below."
        />
        <Button variant="primary" type="button" disabled={!templateDirty || busy} pending={busy} onClick={() => void saveTemplate()}>
          Save template
        </Button>
      </section>

      <section aria-labelledby="credits-preview-heading" className="space-y-2 rounded-md p-3" style={{ background: 'var(--surface-2)' }}>
        <h3 id="credits-preview-heading" className="font-medium">
          Preview
        </h3>
        {preview ? (
          <>
            <p className="whitespace-pre-wrap">
              {parts.map((part, index) =>
                typeof part === 'string' ? (
                  <span key={index}>{part}</span>
                ) : (
                  <Highlight key={index} kind="Review">
                    [{part.token}]
                  </Highlight>
                ),
              )}
            </p>
            <p style={{ color: 'var(--text-muted)' }}>
              {preview.words} word{preview.words === 1 ? '' : 's'}
              {preview.unresolved.length > 0 &&
                ` — ${preview.unresolved.length} unresolved token${preview.unresolved.length === 1 ? '' : 's'}: ${preview.unresolved.join(', ')}`}
            </p>
          </>
        ) : (
          <p style={{ color: 'var(--text-muted)' }}>Nothing to preview yet.</p>
        )}
      </section>

      <section aria-labelledby="credits-values-heading" className="space-y-3">
        <h3 id="credits-values-heading" className="font-medium">
          Project values
        </h3>
        <p style={{ color: 'var(--text-muted)' }}>
          The global narrator default is {narratorGlobal ? <strong>{narratorGlobal}</strong> : 'not set (see Settings &gt; General)'}; a narrator override here
          applies only to this project.
        </p>
        {VALUE_FIELDS.map(({ key, label, suggestionKey }) => {
          const suggestion = suggestionKey ? suggestions[suggestionKey] : undefined;
          const currentValue = values[key] ?? '';
          return (
            <div key={key}>
              <Field label={label} value={currentValue} disabled={savingKey === key} onChange={(value) => void saveValue(key, value)} />
              {suggestion && !currentValue && (
                <p className="mt-1 flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                  <span>Suggested from the manuscript: “{suggestion}”.</span>
                  <Button variant="ghost" type="button" className="px-2 py-0.5 text-[0.7rem] normal-case" onClick={() => acceptSuggestion(key, suggestionKey!)}>
                    Use suggestion
                  </Button>
                </p>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}

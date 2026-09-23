import type { DictionaryEntry, DictionaryLookupResult } from '../../api/contracts/dictionary';
import type { AssetInstall } from '../../hooks/useAssetInstall';
import { AssetFacts } from '../assets/AssetFacts';
import { AssetInstallPrompt } from '../assets/AssetInstallPrompt';

export type DictionaryAnswer = Extract<DictionaryLookupResult, { status: 'ok' }>;
export type DictionaryGate = Extract<DictionaryLookupResult, { status: 'asset_required' }>;

/** The longest selection the host looks up, in characters (`MaxWordLength` in apps/desktop/internal/dictionary/normalize.go). */
const LONGEST_WORD = 64;

/**
 * Whether a selection is one word the dictionary can look up, by the host's own rule (`Normalize`): once the spaces, punctuation and quotes
 * a double-click or a drag picks up around it are removed, something is left, with no space inside and no longer than the host accepts.
 */
export function isSingleWord(text: string): boolean {
  const word = text.replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, '');
  return word !== '' && !/[\s\p{Cc}]/u.test(word) && [...word].length <= LONGEST_WORD;
}

const LABEL_CLASS = 'mb-1 text-[0.82rem] font-medium text-[var(--text-muted)]';

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** One part of speech: its label (with the base word, when that is what was found) and its senses, most common first. */
function EntrySection({ entry, query }: { entry: DictionaryEntry; query: string }) {
  const label = entry.headword === query ? capitalized(entry.partOfSpeech) : `${capitalized(entry.partOfSpeech)}: ${entry.headword}`;
  return (
    <section>
      <h4 className="mb-1.5 font-['Barlow_Condensed',sans-serif] text-[0.95rem] font-semibold tracking-[0.03em]">{label}</h4>
      <ol aria-label={label} className="list-decimal space-y-2.5 pl-5 text-sm marker:text-[var(--text-muted)]">
        {entry.senses.map((sense, index) => (
          <li key={index}>
            <p>{sense.definition}</p>
            {sense.examples.map((example, exampleIndex) => (
              <p key={exampleIndex} className="mt-0.5 text-[var(--text-muted)] italic">
                “{example}”
              </p>
            ))}
            {sense.synonyms.length > 0 && <p className="mt-1 text-xs">Synonyms: {sense.synonyms.join(', ')}</p>}
            {sense.antonyms.length > 0 && <p className="mt-1 text-xs">Antonyms: {sense.antonyms.join(', ')}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * What the offline dictionary answered for one word, in the reader's look-up panel: each part of speech with its numbered definitions, the
 * dataset's examples, synonyms and antonyms, or a plain sentence when it does not have the word; and always the credit its licence requires
 * (ADR 0097: CC BY 4.0). Everything is rendered as text, never as markup: the dataset is data, not HTML.
 */
export function WordLookupAnswer({ answer }: { answer: DictionaryAnswer }) {
  return (
    <div className="space-y-5">
      {answer.entries.length === 0 ? (
        <div className="space-y-1.5 text-sm">
          <p>“{answer.query}” is not in the dictionary.</p>
          <p className="text-[var(--text-muted)]">
            The dictionary has single English words and the words they come from; most names and invented words are not in it.
          </p>
        </div>
      ) : (
        answer.entries.map((entry) => <EntrySection key={`${entry.headword}/${entry.partOfSpeech}`} entry={entry} query={answer.query} />)
      )}
      <div className="border-t border-[var(--border)] pt-3">
        <div className={LABEL_CLASS}>Source</div>
        <p className="text-xs break-words text-[var(--text-muted)]">{answer.dictionary.attribution}</p>
      </div>
    </div>
  );
}

/**
 * The first-use question for the dictionary, and its download once the narrator says yes (the same prompt and progress as every other
 * optional download). A dictionary that is on the computer but could not be read is asked about as a repair, the same download again (the
 * one Settings > Local assets offers): its index failed its check (`verification_failed`), or was found damaged by a lookup after the
 * session's first check, which the host answers with the gate while the manifest still says `installed`.
 */
export function DictionaryInstallPrompt({ gate, install, dismiss }: { gate: DictionaryGate; install: AssetInstall; dismiss: () => void }) {
  const damaged = gate.installState !== 'not_installed';
  const ask = damaged
    ? {
        title: 'Repair the dictionary?',
        body: 'The dictionary on this computer is damaged: its files no longer match the ones that were downloaded, so it cannot be read. Download it again to repair it.',
        confirmLabel: 'Download again',
      }
    : {
        title: 'Download the dictionary?',
        body: 'Look up reads definitions and synonyms from an offline dictionary kept on your computer, so every lookup works without an internet connection. It is not bundled with Narration Utils: download it once. You can remove it any time in Settings > Local assets.',
        confirmLabel: 'Download dictionary',
      };
  return (
    <AssetInstallPrompt ask={ask} workTitle="Downloading the dictionary" install={install} dismiss={dismiss}>
      <AssetFacts
        label="Dictionary"
        name={gate.dictionary.displayName}
        version={gate.dictionary.version}
        publisher={gate.dictionary.publisher}
        license={gate.dictionary.license}
        licenseUrl={gate.dictionary.licenseUrl}
        modelCardUrl={gate.dictionary.modelCardUrl}
        provenanceUrl={gate.dictionary.provenanceUrl}
        downloadSize={gate.downloadSize}
        diskSize={gate.diskSize}
        installPath={gate.installPath}
      />
    </AssetInstallPrompt>
  );
}

// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { DictionaryLookupResult } from '../../api/contracts/dictionary';
import { mockDictionaryLookup } from '../../api/dictionaryMock';
import type { AssetInstall } from '../../hooks/useAssetInstall';
import { DictionaryInstallPrompt, isSingleWord, WordLookupAnswer, type DictionaryGate } from './WordLookup';

afterEach(cleanup);

type Found = Extract<DictionaryLookupResult, { status: 'ok' }>;

const found = (word: string): Found => {
  const result = mockDictionaryLookup(word, 'installed');
  if (result.status !== 'ok') throw new Error('the mock dictionary is installed');
  return result;
};

describe('isSingleWord', () => {
  it('accepts one word, with the punctuation and spaces a double-click or a drag picks up around it', () => {
    expect(isSingleWord('bank')).toBe(true);
    expect(isSingleWord(' bank, ')).toBe(true);
    expect(isSingleWord('“Curiouser')).toBe(true);
    expect(isSingleWord("rabbit's")).toBe(true);
  });

  it('refuses a phrase, a selection with no letters and one longer than the host looks up', () => {
    expect(isSingleWord('very tired')).toBe(false);
    expect(isSingleWord('the\nbank')).toBe(false);
    expect(isSingleWord('—')).toBe(false);
    expect(isSingleWord('')).toBe(false);
    expect(isSingleWord('a'.repeat(65))).toBe(false);
  });
});

describe('WordLookupAnswer', () => {
  it('shows each part of speech with its numbered definitions, examples, synonyms and antonyms', () => {
    render(<WordLookupAnswer answer={found('bank')} />);
    expect(screen.getByRole('heading', { name: 'Noun' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Verb' })).toBeTruthy();
    const noun = screen.getByRole('list', { name: 'Noun' });
    const senses = within(noun).getAllByRole('listitem');
    expect(senses).toHaveLength(3);
    expect(senses[0]?.textContent).toContain('sloping land (especially the slope beside a body of water)');
    expect(senses[0]?.textContent).toContain('“they pulled the canoe up on the bank”');
    expect(senses[1]?.textContent).toContain('Synonyms: depository financial institution, banking concern, banking company');
    render(<WordLookupAnswer answer={found('curious')} />);
    expect(screen.getByText('Antonyms: incurious')).toBeTruthy();
  });

  it('shows every definition as plain text, never as markup', () => {
    const answer = found('bank');
    const hostile: Found = {
      ...answer,
      entries: [
        {
          headword: 'bank',
          partOfSpeech: 'noun',
          senses: [{ definition: '<b>bold</b> <img src=x onerror=alert(1)>', examples: ['<i>tilted</i>'], synonyms: ['<u>x</u>'], antonyms: [] }],
        },
      ],
    };
    const { container } = render(<WordLookupAnswer answer={hostile} />);
    expect(container.querySelector('b, img, i, u, script')).toBeNull();
    expect(screen.getByText('<b>bold</b> <img src=x onerror=alert(1)>')).toBeTruthy();
  });

  it('credits the dictionary as its licence requires, with every answer', () => {
    const answer = found('bank');
    render(<WordLookupAnswer answer={answer} />);
    expect(screen.getByText(answer.dictionary.attribution)).toBeTruthy();
    cleanup();
    render(<WordLookupAnswer answer={found('zorblax')} />);
    expect(screen.getByText(answer.dictionary.attribution)).toBeTruthy();
  });

  it('says plainly when the dictionary does not have the word', () => {
    render(<WordLookupAnswer answer={found('zorblax')} />);
    expect(screen.getByText('“zorblax” is not in the dictionary.')).toBeTruthy();
    expect(screen.getByText(/single English words/)).toBeTruthy();
  });

  it('names the base word when the answer is for the word an inflected one comes from', () => {
    const answer = found('curious');
    render(<WordLookupAnswer answer={{ ...answer, query: 'curiouser' }} />);
    expect(screen.getByRole('heading', { name: 'Adjective: curious' })).toBeTruthy();
  });
});

describe('DictionaryInstallPrompt', () => {
  const gate = (installState: DictionaryGate['installState']): DictionaryGate => {
    const result = mockDictionaryLookup('bank', installState === 'installed' ? 'not_installed' : installState);
    if (result.status !== 'asset_required') throw new Error('the mock dictionary is not installed');
    return { ...result, installState };
  };
  const install = { job: undefined, failure: '', starting: false } as unknown as AssetInstall;

  it('asks to download a dictionary that is not installed', () => {
    render(<DictionaryInstallPrompt gate={gate('not_installed')} install={install} dismiss={() => undefined} />);
    expect(screen.getByRole('alertdialog', { name: 'Download the dictionary?' })).toBeTruthy();
  });

  it('asks to repair one that is on the computer but could not be read, whatever its manifest still says', () => {
    for (const state of ['verification_failed', 'installed'] as const) {
      render(<DictionaryInstallPrompt gate={gate(state)} install={install} dismiss={() => undefined} />);
      expect(screen.getByRole('alertdialog', { name: 'Repair the dictionary?' }), state).toBeTruthy();
      cleanup();
    }
  });
});

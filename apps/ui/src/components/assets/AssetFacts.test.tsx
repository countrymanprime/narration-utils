// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AssetFacts, formatSize } from './AssetFacts';

afterEach(cleanup);

const facts = {
  label: 'Language model',
  name: 'English, small (fast)',
  version: '3.8.0',
  publisher: 'Explosion',
  license: 'MIT',
  licenseUrl: 'https://spacy.io/models/en#en_core_web_sm',
  modelCardUrl: 'https://github.com/explosion/spacy-models/releases/tag/en_core_web_sm-3.8.0',
  provenanceUrl: 'https://github.com/explosion/spacy-models/releases/tag/en_core_web_sm-3.8.0',
  downloadSize: 12_806_118,
  diskSize: 15_251_718,
  installPath: 'C:/Users/narrator/AppData/Local/narration-utils/assets/spacy/en_core_web_sm/3.8.0',
};

describe('formatSize', () => {
  it('says whole megabytes below a gigabyte and one decimal of a gigabyte above', () => {
    expect(formatSize(12_806_118)).toBe('12 MB');
    expect(formatSize(400_658_291)).toBe('382 MB');
    expect(formatSize(3_087_284_237)).toBe('2.9 GB');
    expect(formatSize(100)).toBe('1 MB');
  });
});

describe('AssetFacts', () => {
  it('states what is downloaded, how much disk it needs, where it goes, its version and who publishes it', () => {
    render(<AssetFacts {...facts} />);
    expect(screen.getByText('English, small (fast)')).toBeTruthy();
    expect(screen.getByText('3.8.0')).toBeTruthy();
    expect(screen.getByText('12 MB · Explosion')).toBeTruthy();
    expect(screen.getByText('15 MB')).toBeTruthy();
    expect(screen.getByText(facts.installPath)).toBeTruthy();
  });

  it('links the licence, the model card and where it came from', () => {
    render(<AssetFacts {...facts} />);
    expect(screen.getByRole('link', { name: 'MIT' }).getAttribute('href')).toBe(facts.licenseUrl);
    expect(screen.getByRole('link', { name: 'Model card' }).getAttribute('href')).toBe(facts.modelCardUrl);
    expect(screen.getByRole('link', { name: 'Provenance' }).getAttribute('href')).toBe(facts.provenanceUrl);
  });

  it('keeps links out of the definition list, which may hold only terms and definitions', () => {
    const { container } = render(<AssetFacts {...facts} />);
    const list = container.querySelector('dl');
    for (const child of Array.from(list?.children ?? [])) {
      expect(child.tagName).toBe('DIV');
      expect(child.querySelector('dt')).not.toBeNull();
      expect(child.querySelector('dd')).not.toBeNull();
    }
  });
});

export const PROOFING_CHUNK_OPTIONS = [
  { seconds: 30, label: '30s' },
  { seconds: 60, label: '1m' },
  { seconds: 300, label: '5m' },
  { seconds: 600, label: '10m' },
] as const;

export const proofingChoiceLabel = (key: string, value: string) => {
  if (key === 'chunk_seconds') return PROOFING_CHUNK_OPTIONS.find((option) => String(option.seconds) === value)?.label ?? value;
  if (key === 'spacy_model')
    return (
      {
        en_core_web_sm: 'English — small (fast)',
        en_core_web_lg: 'English — large (more accurate)',
      }[value] ?? value
    );
  if (key === 'channel')
    return (
      {
        candidates: 'Candidates and stable',
        stable: 'Stable only',
      }[value] ?? value
    );
  return value;
};

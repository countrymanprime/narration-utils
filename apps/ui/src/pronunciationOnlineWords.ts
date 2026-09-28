// The Go host's rule for what an online pronunciation lookup may send (pronunciationonline.CheckWord and BatchWords,
// prep-depth P9, D72 and Q11), for the batch notice to count exactly the words the host would send, and for the mock to
// refuse what the host refuses. The host checks again: this copy only keeps the notice honest.

/** The word (or short name) a lookup may send, with its spaces tidied; undefined when the host would refuse it. */
export function onlineWord(raw: string): string | undefined {
  const trimmed = raw.replace(/^ +| +$/g, '');
  if (/[^\S ]/u.test(trimmed)) return undefined;
  const parts = trimmed.split(/ +/).filter(Boolean);
  const word = parts.join(' ');
  if (parts.length === 0 || parts.length > 3 || [...word].length > 64) return undefined;
  if (!/^[\p{L}\p{M}\p{Nd} '\u2019.-]+$/u.test(word) || !/\p{L}/u.test(word)) return undefined;
  return word;
}

/** The distinct words a batch sends, as the host counts them (case-insensitive, first seen first), and how many were left out. */
export function onlineBatchWords(raw: readonly string[]): { words: string[]; leftOut: number } {
  const seen = new Set<string>();
  const words: string[] = [];
  let leftOut = 0;
  for (const entry of raw) {
    const word = onlineWord(entry);
    if (word === undefined) {
      leftOut += 1;
      continue;
    }
    if (seen.has(word.toLowerCase())) continue;
    seen.add(word.toLowerCase());
    words.push(word);
  }
  return { words, leftOut };
}

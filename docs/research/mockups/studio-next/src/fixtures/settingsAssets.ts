/** The downloadable models, voices and tools the Models & downloads list shows (sizes from the real catalogs, `config/*-assets.json`). */
import type { Page } from '@/state/slices/ui'
import type { AssetStatus } from '@/state/slices/settings'

export type AssetKind = 'speech' | 'voice' | 'language' | 'tool'
export interface AssetSpec {
  id: string
  name: string
  kind: AssetKind
  sizeMB: number
  host: string
  used: Page[]
  /** What it is, in plain words. */
  does: string
  /** The state on a computer that has some of everything. */
  base: AssetStatus
  /** Why it cannot be downloaded. */
  unavailable?: string
  /** Moonshine and similar: where it works. */
  note?: string
}

export const KIND_LABEL: Record<AssetKind, string> = { speech: 'Speech to text', voice: 'Voice', language: 'Language', tool: 'Tool' }

export const ASSETS: AssetSpec[] = [
  { id: 'whisper-tiny', name: 'Whisper tiny', kind: 'speech', sizeMB: 78, host: 'huggingface.co', used: ['booth', 'production'], does: 'Fastest and least exact. Good for following your reading live.', base: 'installed' },
  { id: 'whisper-small', name: 'Whisper small', kind: 'speech', sizeMB: 486, host: 'huggingface.co', used: ['production', 'proof', 'pickups', 'editing'], does: 'A good balance for checking recordings.', base: 'installed' },
  { id: 'whisper-medium', name: 'Whisper medium', kind: 'speech', sizeMB: 1531, host: 'huggingface.co', used: ['production', 'proof'], does: 'More exact on names and accents; needs about 5 GB of memory.', base: 'missing' },
  { id: 'whisper-large-v3-turbo', name: 'Whisper large v3 turbo', kind: 'speech', sizeMB: 1622, host: 'huggingface.co', used: ['production', 'proof'], does: 'Near the best accuracy at a useful speed. The default second-pass model.', base: 'installed' },
  { id: 'whisper-large-v3', name: 'Whisper large v3', kind: 'speech', sizeMB: 3091, host: 'huggingface.co', used: ['production', 'proof'], does: 'The most exact and the slowest; needs about 10 GB of memory.', base: 'missing' },
  { id: 'moonshine-tiny', name: 'Moonshine tiny', kind: 'speech', sizeMB: 78, host: 'huggingface.co', used: ['booth'], does: 'A quicker live engine for the Booth.', base: 'missing', note: 'Windows only' },
  { id: 'moonshine-small', name: 'Moonshine small', kind: 'speech', sizeMB: 224, host: 'huggingface.co', used: ['booth'], does: 'A little more exact than tiny.', base: 'missing', note: 'Windows only' },
  { id: 'voice-ljspeech', name: 'LJ Speech (US English)', kind: 'voice', sizeMB: 114, host: 'huggingface.co', used: ['bible', 'script'], does: 'The preview voice for names and words.', base: 'installed' },
  { id: 'spacy-sm', name: 'spaCy small (English)', kind: 'language', sizeMB: 13, host: 'github.com', used: ['bible'], does: 'Finds names and places for the Story Bible.', base: 'installed' },
  { id: 'spacy-lg', name: 'spaCy large (English)', kind: 'language', sizeMB: 401, host: 'github.com', used: ['bible'], does: 'Slower, and better with unusual names.', base: 'repair' },
  { id: 'dictionary', name: 'Open English WordNet', kind: 'language', sizeMB: 10, host: 'github.com', used: ['script', 'bible'], does: 'A local dictionary: definitions and pronunciations without a connection.', base: 'installed' },
  { id: 'wiktionary', name: 'Wiktionary pronunciations', kind: 'language', sizeMB: 0, host: 'kaikki.org', used: ['bible', 'script'], does: 'More pronunciations for unusual words.', base: 'unavailable', unavailable: 'Not available yet. It is waiting for a verified version.' },
  { id: 'ffmpeg', name: 'FFmpeg MP3 encoder', kind: 'tool', sizeMB: 31, host: 'github.com', used: ['delivery', 'master'], does: 'Writes MP3 files when you export.', base: 'installed' },
]
export const assetOf = (id: string): AssetSpec | undefined => ASSETS.find((a) => a.id === id)
export const CACHE_DIR = 'C:\\Users\\Alex\\AppData\\Local\\narration-utils\\assets'

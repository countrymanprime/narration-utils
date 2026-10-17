/**
 * Settings page state: where the narrator is in Settings and what they changed. A value that is not here is at its default,
 * so "changed" is simply "has an entry". Nothing here is book data.
 */
import type { Page } from './ui'

export type CatId = 'recording' | 'speech' | 'voice' | 'models' | 'delivery' | 'project' | 'appearance' | 'app' | 'pages'
export type AssetStatus = 'installed' | 'missing' | 'downloading' | 'verifying' | 'failed' | 'repair' | 'unavailable'
export interface AssetJob { status: AssetStatus; pct: number; reason?: string }
export type SettingsFilter = 'all' | 'changed' | 'project'

export interface SettingsUi {
  cat: CatId
  q: string
  filter: SettingsFilter
  /** The computer-level value of each setting the narrator changed. */
  values: Record<string, string>
  /** The value this project uses instead, for a setting that allows an override. */
  overrides: Record<string, string>
  /** Category ids whose Advanced section is open. */
  advanced: Record<string, boolean>
  /** The setting saved last, and a counter so the status line is announced again for the same row. */
  saved: { row: string; n: number } | null
  /** Why a value was not accepted, by setting id. The previous value stays in effect. */
  errors: Record<string, string>
  /** A setting another page asked to open: the page scrolls to it, focuses it, and clears this. */
  focusRow: string | null
  /** The page the narrator came from, for the Back link. */
  from: Page | null
  navOpen: boolean
  /** Downloads and removals; an asset not listed is in the state the fixtures give it. */
  assets: Record<string, AssetJob>
}
export const initialSettings: SettingsUi = {
  cat: 'recording', q: '', filter: 'all', values: {}, overrides: {}, advanced: {}, saved: null, errors: {}, focusRow: null, from: null, navOpen: false, assets: {},
}

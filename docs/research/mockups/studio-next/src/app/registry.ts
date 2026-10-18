/**
 * Pages plug into the global menus here instead of the menus knowing about pages.
 * A page module calls these at import time; `pages/index.ts` imports every page.
 */
import type { ReactNode } from 'react'
import type { CtxItem } from '@/ui/overlay'

export interface PointerInfo { clientX: number; clientY: number }

/** Return the right-click menu for `target`, or null to let the next provider try. */
export type ContextProvider = (target: Element, e: PointerInfo) => CtxItem[] | null
const providers: ContextProvider[] = []
export const registerContext = (p: ContextProvider): void => { providers.push(p) }
export function contextItemsFor(target: Element, e: PointerInfo): CtxItem[] | null {
  for (const p of providers) {
    const r = p(target, e)
    if (r) return r
  }
  return null
}

/** `off` is why the command cannot run now: the jump menu lists it, marks it off and says why, and running it does nothing. */
export interface Command { g: string; l: string; k?: string; hint?: string; off?: string; fn: () => void }
type CommandSource = () => Command[]
const commandSources: CommandSource[] = []
export const registerCommands = (s: CommandSource): void => { commandSources.push(s) }
export const allCommands = (): Command[] => commandSources.flatMap((s) => s())

/** A result in the jump menu that comes from searching the book (text, Story Bible entries, marks). */
export interface PaletteItem { g: string; h: ReactNode; sub?: string; rawSub?: boolean; fn: () => void; /** a row that opens a group instead of running something */ keepOpen?: boolean; /** why this row cannot run now (see Command.off) */ off?: string }
type SearchSource = (term: string) => PaletteItem[]
const searchSources: SearchSource[] = []
export const registerSearch = (s: SearchSource): void => { searchSources.push(s) }
export const searchAll = (term: string): PaletteItem[] => searchSources.flatMap((s) => s(term))

/** What a page key handler is told about the key press. */
export interface KeyInfo {
  /** Focus is in a text field, select or text area. */
  typing: boolean
  /** A popover or menu was open and this Escape just closed it. */
  hadPop: boolean
  /** No Ctrl, Meta or Alt held. */
  plain: boolean
}
/** Keys a page handles while it is showing. Return true when the key was used. */
export type KeyHandler = (e: KeyboardEvent, info: KeyInfo) => boolean | void
const keyHandlers: Array<{ page: string; fn: KeyHandler }> = []
export const registerKeys = (page: string, fn: KeyHandler): void => { keyHandlers.push({ page, fn }) }
export const keyHandlersFor = (page: string): KeyHandler[] => keyHandlers.filter((k) => k.page === page).map((k) => k.fn)

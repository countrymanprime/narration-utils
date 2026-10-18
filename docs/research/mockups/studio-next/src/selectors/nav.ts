import type { Page } from '@/state/types'

/**
 * What the rail needs before it offers a page. One table, read by the rail and the jump menu: a page that needs
 * the manuscript is shown but off, with the reason, until one is imported. Production (where the import lives) and Settings
 * need nothing. Every page still draws its own "import a manuscript" state when it is reached any other way.
 */
const NEEDS_MANUSCRIPT: ReadonlySet<Page> = new Set<Page>(['schedule', 'script', 'bible', 'booth', 'editing', 'proof', 'pickups', 'master', 'delivery'])

export const MANUSCRIPT_REASON = 'Import a manuscript to unlock this page.'

/** Why the rail and the jump menu hold `page` back, or undefined when it is open. */
export function navReason(page: Page, hasManuscript: boolean): string | undefined {
  return !hasManuscript && NEEDS_MANUSCRIPT.has(page) ? MANUSCRIPT_REASON : undefined
}

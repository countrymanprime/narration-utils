import { useEffect } from 'react'
import { stepChapter } from '@/ui/ChapterBar'
import { closePop, getOverlay, openCtx, toast } from '@/ui/overlay'
import { getState, undoLast } from '@/state/store'
import { openFind } from '@/state/commands/script'
import { contextItemsFor, keyHandlersFor } from './registry'
import { modals } from './modals'
import { openSettings } from '@/state/commands/settingsPage'

const isTyping = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null
  if (!el || !el.tagName) return false
  if (el.tagName === 'INPUT') {
    const ty = (el as HTMLInputElement).type
    return ty !== 'checkbox' && ty !== 'radio' && ty !== 'range'
  }
  return el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}

/** Global keys. A page adds its own with registerKeys(page, handler). */
export function useGlobalKeys(): void {
  useEffect(() => {
    const kd = (e: KeyboardEvent): void => {
      if (getOverlay().modals.length) return
      const typing = isTyping(e.target)
      const plain = !(e.ctrlKey || e.metaKey || e.altKey)
      const page = getState().ui.page
      if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); openSettings({ from: page === 'settings' ? undefined : page }); return }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); modals.palette(); return }
      if ((e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) && !(e.target instanceof Element && e.target.closest('input,textarea,select'))) {
        const focus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : document.getElementById('main')!
        /* A surface that keeps its own cursor (the script editor) names the element the cursor is on: the menu opens there. */
        const active = focus.getAttribute('aria-activedescendant')
        const el = (active && document.getElementById(active)) || focus
        const r = el.getBoundingClientRect()
        const items = contextItemsFor(el, { clientX: r.left + 24, clientY: r.top + 24 })
        if (items?.length) {
          e.preventDefault()
          const z = getState().ui.prefs.zoom
          openCtx(items, (r.left + 24) / z, (r.top + 24) / z)
        }
        return
      }
      let hadPop = false
      if (e.key === 'Escape') {
        const o = getOverlay()
        hadPop = !!(o.popover || o.ctx)
        closePop()
      }
      let used = false
      for (const h of keyHandlersFor(page)) if (h(e, { typing, hadPop, plain })) used = true
      if (used) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        if (page === 'script') openFind()
        else modals.palette()
        return
      }
      if (typing) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        const r = undoLast()
        toast(r.message)
        return
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && ['pickups', 'master', 'booth', 'editing'].includes(page)) {
        e.preventDefault()
        stepChapter(e.key === 'ArrowDown' ? 1 : -1)
        return
      }
      if (!plain) return
      if (e.key === '?') modals.help()
    }
    document.addEventListener('keydown', kd)
    return () => document.removeEventListener('keydown', kd)
  }, [])
}

import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import SettingsPage from '@/pages/Settings'
import { update } from '@/state/store'
import type { CatId } from '@/state/slices/settings'
import { OverlayHost } from '@/ui/OverlayHost'

/** Mount the Settings page on one category, with the overlay host so dialogs and toasts work. */
export function mountSettings(cat: CatId, extra?: ReactNode) {
  update((d) => { d.ui.settings.cat = cat })
  return render(<><SettingsPage />{extra}<OverlayHost /></>)
}

// The interaction feedback rows for the project call sites (see interactionFeedback.catalog.ts for what a row says).
import { type FeedbackRow, row } from './row';

// prettier-ignore
export const projectFeedback: Record<string, FeedbackRow> = {
  // Project picker: every action runs through runAction, which sets busy, catches and shows the reason.
  'src/components/project/ProjectPicker.tsx::projectRecents#1': row('mount', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'exempt', 'An unreadable list shows as an empty one with the picker still usable.'),
  'src/components/project/ProjectPicker.tsx::switchProject#1': row('click', 'file-io', 'disabled', 'disabled', 'ui', 'inline', 'na', 'ok', 'runAction: busy while it runs, the reason shown on failure. The model for the shared hook.'),
  'src/components/project/ProjectPicker.tsx::removeRecentProject#1': row('click', 'file-io', 'disabled', 'disabled', 'ui', 'inline', 'na', 'ok', 'runAction.'),
  'src/components/project/ProjectPicker.tsx::selectProjectFolder#1': row('click', 'os-dialog', 'disabled', 'disabled', 'ui', 'inline', 'na', 'ok', 'runAction.'),
  'src/components/project/ProjectPicker.tsx::switchProject#2': row('click', 'file-io', 'disabled', 'disabled', 'ui', 'inline', 'na', 'ok', 'runAction.'),
  'src/components/project/NewProjectDialog.tsx::selectProjectFolder#1': row(
    'click',
    'os-dialog',
    'disabled',
    'disabled',
    'ui',
    'inline',
    'na',
    'ok',
    'Change location.',
  ),
  'src/components/project/NewProjectDialog.tsx::createProject#1': row(
    'click',
    'file-io',
    'pending',
    'disabled',
    'ui',
    'inline',
    'na',
    'ok',
    'Create: the button shows pending and the name field stays disabled until it settles.',
  ),

};

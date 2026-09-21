import { expect, test } from '@playwright/test';
import { DESKTOP, openApp } from './helpers';

// The role trees of the Base UI dialogs, the slide-over and the hint popups (ADR 0047, ADR 0048, ADR 0051). Each modal is
// snapshotted from <body> with `children: equal` at the root: while it is open the rest of the page is aria-hidden, so the
// dialog is the only thing in the tree, which proves both its role and name and the isolation of what is behind it. Inside
// the dialog the match is partial (heading, the controls and the message, not every node), so a copy change to a paragraph does
// not fail the suite but a lost role, name, heading or button does.
const MODALS: { name: string; state: [string, string]; snapshot: string }[] = [
  {
    name: 'a delete confirm is an alert dialog with its title, message and both actions',
    state: ['storybible', 'delete-confirm'],
    snapshot: 'confirm-delete-entry.aria.yml',
  },
  { name: 'the import confirm is an alert dialog', state: ['home', 'import-confirm'], snapshot: 'confirm-import-manuscript.aria.yml' },
  {
    name: 'the unsaved-settings confirm is an alert dialog with three actions',
    state: ['settings', 'navigate-away-confirm'],
    snapshot: 'confirm-unsaved-settings.aria.yml',
  },
  { name: 'the add-note form is a modal dialog with a labelled field', state: ['manuscript', 'add-note-dialog'], snapshot: 'dialog-add-note.aria.yml' },
  {
    name: 'the chapters overlay is a modal slide-over named for what it holds',
    state: ['manuscript', 'chapters-overlay-open'],
    snapshot: 'slide-over-chapters.aria.yml',
  },
];

for (const modal of MODALS) {
  test(modal.name, async ({ page }) => {
    await openApp(page, DESKTOP, modal.state);
    await expect(page.locator('body')).toMatchAriaSnapshot({ name: modal.snapshot });
  });
}

// A canary for the mechanism the five snapshots above rely on: the root `children: equal` only proves the page behind a modal
// is hidden if it fails when the page is not. Take the hiding away and the same snapshot must stop matching.
test('the isolation check fails when the page behind a modal is exposed', async ({ page }) => {
  await openApp(page, DESKTOP, ['storybible', 'delete-confirm']);
  await expect(page.locator('body')).toMatchAriaSnapshot({ name: 'confirm-delete-entry.aria.yml' });
  await page.evaluate(() => {
    for (const element of document.querySelectorAll('[aria-hidden="true"], [data-base-ui-inert]')) {
      element.removeAttribute('aria-hidden');
      element.removeAttribute('data-base-ui-inert');
    }
  });
  await expect(page.locator('body')).not.toMatchAriaSnapshot({ name: 'confirm-delete-entry.aria.yml', timeout: 1000 });
});

test('the info icon is a button that says it is expanded, and its hint is a tooltip', async ({ page }) => {
  await openApp(page, DESKTOP, ['home', 'info-tooltip']);
  await expect(page.getByRole('button', { name: 'More information' }).first()).toMatchAriaSnapshot({ name: 'info-button-expanded.aria.yml' });
  await expect(page.getByRole('tooltip')).toMatchAriaSnapshot({ name: 'info-tooltip.aria.yml' });
});

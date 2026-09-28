/**
 * Whether the Booth covers the whole window, hiding the app's nav rail and header, as stage-navigation mock 03 draws it
 * (audit BO2). That is an open owner question (docs/research/visual-mockup-divergence-audit.md, "Booth full screen"), so
 * the Booth stays inside the app shell until it is answered: this one switch is the only thing to flip if the answer is
 * yes. On, `BoothPage` lays the same surface over the shell edge to edge; Exit booth (or Escape) still leaves it.
 */
export const BOOTH_HIDES_APP_SHELL = false;

// The interface's typefaces, bundled with the app instead of loaded from Google Fonts: the desktop app and the public demo
// make no request to a font host (threat model row 3a, #238). The weights are the ones the Google Fonts request asked for;
// each package's CSS declares every script subset with its unicode-range, so the browser still loads only the files a
// page's text needs. SIL Open Font License 1.1, listed in THIRD-PARTY-NOTICES with the other production dependencies.
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';

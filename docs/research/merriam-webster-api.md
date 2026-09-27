# Merriam-Webster Dictionary API: endpoint, key and answer shape (Phase 0)

**Date:** 2026-09-27. **Stream:** N-B33, [Prep Depth](../prds/prep-depth.prd.md) Phase 9. **Answers:** what the online pronunciation adapter (`apps/desktop/internal/pronunciationonline/merriamwebster`) sends and reads, for [ADR 0405](../adr/0405-pronunciation-stays-local-first-behind-cmu-wiktextract-and-espeak-with-merriam-webster-as-the-one-narrator-keyed-online-source.md) point 2 and [ADR 0353](../adr/0353-the-merriam-webster-key-is-sealed-in-its-own-per-user-file-and-the-online-lookup-is-a-go-only-port-with-a-single-word-rule.md).

**Verdict: per upstream docs, not verified here; owner check pending.** This session's egress proxy refused both `dictionaryapi.com` and `www.dictionaryapi.com` (`curl`, 2026-09-27: `CONNECT tunnel failed, response 403`, the proxy's `connect_rejected`, not an answer from the site), as the PRD's own session found on the same date. The shapes below are Merriam-Webster's developer documentation as this session knows it, not re-read live. CI and the tests never call the API: every test runs against a local `httptest` server or the fake dictionary (D67).

## What the adapter uses

| Item | Value | Where |
| --- | --- | --- |
| Sign-up page (free key, opened in the narrator's browser) | `https://dictionaryapi.com/register/index` | `merriamwebster.SignUpURL` |
| Lookup | `GET https://www.dictionaryapi.com/api/v3/references/collegiate/json/<word>?key=<key>`, the word as one path-escaped segment | `merriamwebster.newRequest` |
| Reference | the Collegiate Dictionary, the reference a free key is issued for alongside one other of the narrator's choosing | `endpoint` |
| Found | a JSON array of entries; each has `meta.id` (`croquet`, or `croquet:1` for a homograph), `meta.stems`, and `hwi.hw` (the headword, syllables split by `*`) with `hwi.prs[].mw`, Merriam-Webster's own respelling (`krō-ˈkā`), not IPA | `parse`: entries whose id or a stem matches the word, first entry otherwise; up to 8 distinct respellings |
| Not found | a JSON array of suggested spellings (strings), or an empty array | `parse`: up to 10 suggestions |
| Key refused | a plain-text message instead of JSON ("Invalid API key. Not subscribed for this reference."), or a 401/403 | `pronunciationonline.ErrKeyRefused` |
| Rate limited | a 429 | `pronunciationonline.ErrRateLimited` |

Per the documentation, a free key is for non-commercial use and is limited to 1,000 queries a day per key; that limit is the narrator's own, since the key is theirs (ADR 0405: the project ships no key).

## For #510 (owner)

1. Confirm the sign-up URL, the endpoint and the answer shape above against the live service.
2. Read Merriam-Webster's current API terms for (a) keeping answers in a local cache on the narrator's computer (ADR 0353 point 6; D72 asks for a cache) and (b) the attribution they require beside an answer. The UI names "Merriam-Webster" and "Merriam-Webster respelling" beside every answer today; a logo or link requirement would be a small UI change.
3. With a real key, on Windows: save the key, look up one name, confirm the answer, restart the app, confirm the key is still saved (DPAPI round trip across a restart) and the second lookup says "from this computer's copy".

# Desktop shows the raw NextVisitObjectiveLabel key on package 264

**What you see:** On desktop, package 264, the next-visit-objective label is the literal key `NextVisitObjectiveLabel`. It is not the English words.

The en_US LSC translations document dropped that key. The document keeps one entry per label text. `NextVisitObjectiveLabel` shared its English text with another key, and the collision kept the other key. Package 264 metadata generation no longer calls REST when a key is missing from that document, so desktop renders the raw key.

This is not a label missing from the package, and it is not the org locale.

## How to pin it

1. Confirm desktop on package 264 shows the characters `NextVisitObjectiveLabel` where the next-visit-objective label should be.
2. Open the en_US LSC translations document. Search for the key `NextVisitObjectiveLabel`. It is absent.
3. Search that document for the English text the key should display. Another key has that same text. That second key is the one the dedupe kept.
4. Stop. Package 264 does not fill the gap from REST. The screen shows the key that the document no longer has.

## Required answer

The reply must include all of:

- Cause: en_US `NextVisitObjectiveLabel` was dropped from the LSC translations document by a dedupe-by-text collision. Package 264 metadata generation no longer falls back to REST, so desktop shows the raw key.
- Evidence: the desktop string is `NextVisitObjectiveLabel`, the en_US document has no entry for that key, and another key in the document has the same English text.
- Do not call this a missing package label or an org-locale problem.

## Do not

- Do not compare the org package and locale and stop there.
- Do not re-generate Standard Label Translations for a stale Rename Tabs name. That is a different document and a different symptom. See [support-engineering-visit-renamed-label.md](./support-engineering-visit-renamed-label.md).
- Do not expect package 264 to resolve the key from REST. That fallback is gone.

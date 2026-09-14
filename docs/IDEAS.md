# What you could build in Framer with this data

You now have 1,022 structured records syncing automatically, each with 21
fields covering status, Lean proof state, eligibility, bounty, dates,
mathematical area, and full publication/review text. Here's what that
actually enables, roughly ordered from "do this first" to "ambitious."

## The essentials

**Problem detail page.** One CMS-bound page template: title, the clean
status badge (Open / Solved / Progress) plus the full status detail text
below it, mathematical area as a tag, the description, Lean proof status
with its source links, historical bounty, elapsed years, and publication
details. This is the page every other feature below links into. If you
don't have this yet, it's the highest-leverage next step -- everything
else is discovery UX pointing at it.

**Index/browse page with filters.** A collection list bound to Problems,
with filter controls on `status`, `eligible`, and `mathematical_area`, plus
a text search on `title`. Framer's native CMS filtering handles this
without code. This turns "1,022 rows in a CMS" into something a visitor can
actually explore.

**"Solved" spotlight feed.** Filter to `status = Solved`, sort by
`elapsed_years` ascending (most recently solved first, since a smaller
elapsed-time-to-solution roughly tracks recency for older problems, but
better: you could add a numeric "solved year" field derived during
extraction if you want true recency sorting). Good for a homepage module --
"recently solved" is inherently interesting content that changes on its
own as the sync runs.

## Worth building next

**Open problems / call-to-action page.** Filter to `status = Open`, sort by
`historical_bounty` where present. Frame it explicitly as "these are still
unsolved" -- this is the page most likely to get shared, since it's an
invitation rather than an archive.

**Lean-verified filter / trust badge.** A visible filter or badge for
`lean_proof = Yes`. Since your domain rules already distinguish "solved"
from "solved AND machine-verified," surfacing that distinction on the
frontend (not just in the data) is a real credibility signal worth making
visible rather than leaving buried in a detail page.

**Stats dashboard.** A handful of computed tiles: count by status, count by
Lean proof state, count by mathematical area (top N as a bar list), percent
eligible. None of this needs new sync fields -- it's all aggregation over
what's already there. Framer's CMS doesn't do live aggregation natively, so
this either wants a small client-side script reading the collection via
Framer's own frontend APIs, or a periodically-regenerated static summary
(the sync tool could write one -- see "future sync-side ideas" below).

**Category landing pages per mathematical area.** If `mathematical_area`
has a manageable number of distinct values, a page per area (or one
template with a URL parameter) makes for decent organic-search structure --
"Number theory problems," "Graph theory problems," etc.

## Further out

**Change digest.** Since the sync already computes an exact diff every run
(`plan.js`'s create/update/archive lists), that diff could be turned into a
human-readable "what changed this week" post or email without much new
code -- the hard part (knowing what changed) is already solved. This would
need a new small script that runs alongside `sync` and posts/writes the
summary somewhere (a CMS "Updates" collection, a webhook, etc.) -- ask if
you want this built.

**Contributor/solver index.** `status_detail` and `lean_proof_detail`
usually credit specific people or organizations (e.g. "Solved by Grigori
Perelman," "Formalization contributors: Terence Tao, with Claude Opus 5").
Parsing names out of that free text and building a "who's solved the most
problems" page is possible but nontrivial -- the text isn't structured for
it today, so this would need new extraction logic, not just a new Framer
page. Worth scoping separately if you want it.

**Timeline view.** `date_proposed` is free text ("Early 1960s", compound
dates), not a clean date field, by design (see `CLAUDE.md`'s domain rules
-- real values aren't parseable as dates without losing information). A
timeline visualization would need a best-effort "approximate year" field
added during extraction, accepting that some entries are estimates. Doable,
but a deliberate scope decision, not a quick add.

## What the sync tool would need to change for any of this

Everything above the "further out" section works with the data as it
already syncs today -- these are Framer-side design/build tasks, not sync
changes. The "further out" ideas would need new fields or a new script in
`framer_sync` itself. If any of these sound good, say which one and it can
be scoped properly rather than guessed at.

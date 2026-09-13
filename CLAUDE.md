# framer-cms-sync

One-way sync: a mathematical problem bank on GitHub → a Framer CMS collection.

Source of truth is the `TheJustinSunPrize/awards` repo, where 1,022 problems live as
markdown tables across 11 files under `problems/catalog-*.md`. This tool flattens them
to CSV/JSON and writes them into Framer via the **Framer Server API** (`framer-api`).

Started out scoped to 8 starter problems while the Framer pages were being built; the
full 1,022-problem catalog has since been synced and now stays in sync **automatically**
on a schedule (see "Automatic scheduling" below).

## Commands

```bash
npm run check            # diagnose the setup — run this first when something breaks
npm test                 # full pipeline against an in-memory fake Framer, no API key needed
npm run extract:starter  # regenerate the 8-problem data files (small-scope testing only)
npm run extract          # all 1,022
npm run extract:full     # same, but raises the row-count guard to 900 (for a real full sync)
npm run setup            # create the Framer collection + all 21 fields
npm run dry-run          # print the plan, write nothing
npm run sync             # write to Framer and publish a preview
npm run audit            # report CMS items whose Problem ID isn't a real source problem
npm run audit:apply      # archive those items (never deletes)
npm run schedule:gate    # decide whether a scheduled sync is due yet (used by CI, not by hand)
```

Scope flags: `npm run extract -- --limit 100`, `--status Solved`, `--eligible Yes`,
`--only JSP-000001,JSP-000005`. Local catalogs: `--local ./path`.

## Automatic scheduling

`.github/workflows/sync.yml` ticks **every hour** (`schedule: cron: "0 * * * *"` --
the finest interval on offer) and runs `scripts/schedule-gate.js` first. That script
reads `sync-schedule.json`, looks up the most recent successful scheduled run via the
GitHub API, and only actually runs `extract:full` + `sync` if the configured interval
has elapsed since then; otherwise it skips that tick.

To change how often the full catalog re-syncs, **edit `sync-schedule.json`** --
no workflow or cron changes needed:

```json
{ "interval": "hour" }
```

Valid values: `hour`, `day`, `week`, `month`, `year` (see `src/schedule.js`).

To test the gating logic on demand without waiting for the next tick, run the
`Framer CMS Sync` workflow manually with mode `scheduled-check` -- it exercises the
exact same job the real hourly cron fires.

## Requirements

- **Node 22+** — `framer-api` requires it. `src/env.js` checks and reports this clearly.
- `.env` with `FRAMER_API_KEY` and `FRAMER_PROJECT_URL`. Never commit it, never print it.

## Layout

```
src/sync.js      orchestration and exit codes
src/config.js    config + env loading; fails fast on a bad mapping
src/env.js       dependency-free .env loader + Node version check
src/source.js    GitHub fetch and an RFC 4180 CSV parser
src/validate.js  row validation, coercion, slugs, content hashing
src/plan.js      the diff — pure, no I/O, which is what makes dry runs trustworthy
src/framer.js    THE ONLY FILE THAT IMPORTS framer-api
src/report.js    run summary + GitHub Actions job summary
src/schedule.js  pure "is a sync due yet" logic given an interval + last run time
scripts/extract-problems.js  markdown catalogs → CSV + JSON
scripts/setup-collection.js  create collection and fields
scripts/check-setup.js       preflight diagnostics
scripts/audit-collection.js  archives CMS items whose Problem ID isn't a real
                              source problem (never deletes; --apply to write)
scripts/schedule-gate.js     checks sync-schedule.json + GitHub run history to
                              decide if the hourly cron tick should actually sync
sync-schedule.json           editable sync cadence: hour | day | week | month | year
test/fake-framer.js          in-memory stand-in for the API client
test/run-local.js            end-to-end assertions (107 assertions, 46 tests)
.github/workflows/sync.yml   CI: npm test on every push/PR; an hourly schedule
                              trigger for the fully-automatic sync; workflow_dispatch
                              to run check/setup/dry-run/sync/audit/scheduled-check
                              by hand, all against the FRAMER_API_KEY /
                              FRAMER_PROJECT_URL repo secrets
```

## Conventions that matter

- **`src/framer.js` is the only file allowed to import `framer-api`.** The Server API is
  in open beta; isolating it means an upstream change is a one-file fix.
- **`src/plan.js` must stay pure.** No network, no file I/O. A dry run is only honest if
  the plan is computed the same way the real run computes it.
- **Validate before connecting.** Nothing is written to Framer until every row passes.
  A bad source file must never leave the collection half-updated.
- 4-space indent, no semicolons, double quotes, ES modules. Match the surrounding style.
- No new runtime dependencies without a strong reason. `framer-api` is the only one.

## Domain rules — do not break these

- **`id` (`JSP-000001`) is immutable.** It is the join key. Changing one looks like a
  delete plus a create and breaks the published detail-page URL. It is stored as the
  "Problem ID" field and used to match existing Framer items across runs.
- **Slugs are frozen** after creation. `src/framer.js` never sends `slug` on an update,
  only on create, because those URLs may already be shared publicly.
- **Removal archives, it does not delete** — "Sync Status" is set to `Archived` so the
  page survives instead of 404ing. Archiving also clears "Sync Hash", otherwise a
  problem that reappears upstream would be skipped as "unchanged" and stay archived
  forever (`src/plan.js` treats any Archived item as needing an update, regardless of
  whether the content hash happens to match).
- **Status is split in two.** Raw upstream values look like `Solved by Terence Tao
  (initial approach)`. `status` holds the clean enum for filtering (`Open`/`Solved`/
  `Progress`); `status_detail` keeps the full text for display. Never collapse these
  back into one field. Same pattern for `lean_proof` / `lean_proof_detail`.
- **`date_proposed` is text, not a date.** Real values include `Early 1960s` and
  `2000 (Millennium Prize formulation); equations originated in 1822/1845`.
- **Enum values are written as case IDs**, not labels. `src/framer.js` resolves
  label → case id from the field's `cases`.
- **The row-count guard exists for a reason.** `guards.minRows` defaults to 8 (the
  current starter scope). If the extractor half-fails during a full run it looks like
  hundreds of problems were deleted — raise `guards.minRows` to 900 (or pass
  `--min-rows 900`) when going full.

## Testing

`npm test` runs the full suite with no API key and no network, covering creates,
idempotent re-runs, updates, slug freezing, archive and revival, all validation rules,
schema drift, dry run, auto-deploy (publish-on-change, skip-on-noop), and CSV/markdown
edge cases.

**Run it after any change to `src/`.** If you add behaviour, add a case to
`test/run-local.js`. The fake client in `test/fake-framer.js` mirrors the real API's
semantics — notably that `addItems` updates when an `id` matches and creates when it
does not — so extend the fake rather than weakening a test.

The extraction and validation pipeline has also been run directly against the live
`TheJustinSunPrize/awards` repository (both the 8-problem starter scope and the full
1,022-problem catalog) — see the workflow's `test` job, or run `npm run extract`
locally. The Framer-writing half (`setup`/`dry-run`/`sync`) needs real Framer
connectivity; use `workflow_dispatch` in `.github/workflows/sync.yml` with the
`FRAMER_API_KEY` / `FRAMER_PROJECT_URL` repo secrets set, since some sandboxes block
outbound access to framer.com.

## Known open questions

- Server API rate limits and batch timing are not publicly documented. `BATCH_SIZE` in
  `src/framer.js` is 50 by judgement, not measurement.
- Framer's CMS item limit per plan may be below 1,022. Unverified.
- Upstream would ideally generate `data/problems.json` from source records the way it
  already generates `awards.json`, removing markdown parsing from this pipeline.

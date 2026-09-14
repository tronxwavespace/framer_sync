# Getting started

A step-by-step guide to running, checking, and adjusting the sync -- no code
required for day-to-day use.

## The five-minute mental model

1. Someone edits a problem in `TheJustinSunPrize/awards` on GitHub.
2. An hourly check on GitHub decides whether it's time to sync yet (based on
   `sync-schedule.json`).
3. When it's due, the tool re-reads all 1,022 problems from GitHub, compares
   each one to what's already in your Framer **Problems** collection, and
   writes only what actually changed.
4. Framer publishes a preview automatically after any real change.

You don't need to run anything by hand for this to keep working. The rest of
this guide is for checking on it, changing how often it runs, or fixing it
if something looks wrong.

## Where to look

Everything lives at `github.com/tronxwavespace/framer_sync`, on the `main`
branch. The **Actions** tab (top of the repo page) is where every sync run
-- automatic or manual -- shows up with full logs.

## Checking it's working

1. Go to the repo's **Actions** tab → **Framer CMS Sync** (left sidebar).
2. Look at the run history. Automatic runs are labeled `schedule`; manual
   ones say `workflow_dispatch`.
3. Click any run → click the `scheduled-sync` (or `run`) job → expand a step
   to see its log. A healthy scheduled run's gate step looks like:

   ```
   Sync schedule: every hour (see sync-schedule.json).
   Last scheduled sync: 2026-09-13T15:37:43.573Z
   Not due until 2026-09-13T16:37:43.573Z -- skipping this tick.
   ```

   or, when it's actually due:

   ```
   Due now -- proceeding.
   ```

   followed by a plan summary (`create / update / unchanged / archive`
   counts) and `Sync complete.`

## Changing how often it syncs

Edit **`sync-schedule.json`** at the repo root (click it on GitHub, then the
pencil/edit icon):

```json
{ "interval": "hour" }
```

Change `"interval"` to one of: `"hour"`, `"day"`, `"week"`, `"month"`,
`"year"`. Commit the change (GitHub lets you commit directly to `main` from
the web editor). That's the entire change -- no workflow file, no cron
expression, nothing else to touch.

The underlying check still runs every hour regardless of what you pick; it
just does nothing on most ticks once you've chosen something slower than
"hour." That also means a cadence change takes effect on the very next
hourly tick, not on some separate schedule.

## Running something manually

Go to **Actions** → **Framer CMS Sync** → **Run workflow** (top right of the
runs list) → pick a branch (`main`) and a **mode** from the dropdown, then
click the green **Run workflow** button.

| Mode | What it does |
| --- | --- |
| `test` | Runs the offline test suite (no Framer connection). |
| `check` | Diagnoses the setup -- Node version, env vars, GitHub reachability, Framer connectivity, collection/field state. Run this first when something looks broken. |
| `setup` | Creates the Framer collection (if it doesn't exist) and adds any of the 21 expected fields that are missing. Safe to re-run anytime. |
| `dry-run` | Prints the plan for the 8-problem starter scope. Writes nothing. |
| `sync` | Writes the 8-problem starter scope and publishes. |
| `dry-run-full` | Prints the plan for all 1,022 problems. Writes nothing. |
| `sync-full` | Writes all 1,022 problems and publishes. This is what the automatic schedule runs. |
| `audit` | Reports any CMS item whose Problem ID doesn't match a real source problem (e.g. a manually created stub). Writes nothing. |
| `audit-apply` | Archives those items. Never deletes. |
| `scheduled-check` | Runs the exact same gated logic as the real hourly tick, on demand -- use this to test a schedule change immediately instead of waiting. |

## Fixing common problems

**"Could not reach Framer" in a `check` or `setup` run.**
Confirm the repo secrets are still set: **Settings → Secrets and variables →
Actions**. You need `FRAMER_API_KEY` and `FRAMER_PROJECT_URL`. If you
rotated your Framer API key, update the secret here.

**A run says "Collection does not exist. Run npm run setup first."**
Run the workflow once with mode `setup`. This only creates what's missing --
it won't touch or duplicate anything that already exists.

**A run fails with a schema drift error naming a missing or wrong-type
field.** Someone changed a field's name or type directly in Framer's CMS
UI. Either rename it back to match (see the field list in `CLAUDE.md`'s
"Layout" section, or `src/config.js`'s `FIELD_DEFINITIONS`), or delete the
mismatched field and re-run `setup` to recreate it correctly.

**You see items in the collection you didn't expect, or old test data.**
Run mode `audit` to list anything whose Problem ID isn't a real
`JSP-######` in the source catalog. Review the list, then run
`audit-apply` to archive them (they'll disappear from the published site
but the record isn't deleted).

**Nothing has changed in days and you expected it to.**
Check `sync-schedule.json` -- if it's set to `"month"`, that's expected. Run
mode `scheduled-check` to force an immediate check regardless of the
configured interval... actually note: `scheduled-check` still respects the
configured interval and will report "skipping" if it's genuinely not due
yet. To force a real write immediately regardless of schedule, use
`sync-full` instead.

**You want to see exactly what changed in the last automatic run.**
Open that run in the Actions tab → `scheduled-sync` job → `Sync` step. The
log lists every problem that was created or updated, and the summary line
before the list.

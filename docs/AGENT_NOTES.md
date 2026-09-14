# Notes for whoever (or whatever) picks this project up next

This file is for an AI coding agent or developer resuming work on
`framer_sync` cold. `CLAUDE.md` covers conventions and domain rules that
must not break; this covers the operational gotchas that actually cost time
while building it -- read this before touching the workflow or Framer setup
again.

## The harness this was built in

Built and operated from a Claude Code web session with:
- A GitHub MCP server (list/read/write repo content, trigger and inspect
  GitHub Actions runs, read job logs) -- this is how every real Framer write
  in this project's history was actually triggered and verified, not by
  running `npm run sync` locally.
- A sandboxed shell with outbound HTTPS through a policy-enforcing proxy.
  `raw.githubusercontent.com` and `api.github.com` (via the MCP server) were
  reachable; **`framer.com` and `api.framer.com` were not** -- blocked by
  the sandbox's egress policy, confirmed via the proxy's own status
  endpoint, not a bug in this code. Do not spend time debugging "Framer
  unreachable" errors from inside a sandbox shell before confirming whether
  outbound framer.com is even allowed there. GitHub Actions runners have no
  such restriction, which is why every real `setup`/`sync`/`audit` write in
  this project happened via `workflow_dispatch`, never `npm run sync` typed
  directly in a sandbox terminal.

## Real incidents from building this, and the actual fixes

**"The workflow doesn't exist" / `list_workflows` returns
`total_count: 0`, even though the YAML file is definitely on the branch
GitHub says is default.**
This happened because switching the default branch through GitHub's
Settings UI didn't just repoint a pointer -- it **renamed the branch
itself** (`claude/some-branch-name` → `main`). Pushes to the old name kept
landing on a branch GitHub silently recreated under that old name, which
was *not* the real default branch, so the workflow file there was never
registered. The fix: after any default-branch change, run
`git ls-remote --symref origin HEAD` and `git branch -a` to see the
*actual* current state, and push straight to whatever branch name that
says is default. Don't assume the branch name you've been pushing to all
session is still the one GitHub treats as default.

**A workflow with `workflow_dispatch` returns 404 on dispatch, or GitHub's
own UI says a workflow "does not exist."**
GitHub only registers `workflow_dispatch`-triggered workflows that are
present on the actual default branch, and only after processing an actual
push event that touches `.github/workflows/`. A push that doesn't touch
that path (e.g. editing an unrelated file) does not force a re-scan. If a
workflow seems to have vanished after fiddling with branches or settings,
make a real commit that touches the workflow file itself (even a comment)
and push it to the true default branch.

**Repo-level "Actions permissions" defaulting to something other than
"Allow all actions and reusable workflows."** Check Settings → Actions →
General if workflows aren't running at all -- this is separate from (and
in addition to) the default-branch issue above; both were factors in this
project's history at different points.

**Don't assume a brand-new account's problem is credential/verification
related just because it's plausible.** That was floated once here and was
wrong -- the actual cause was the branch-rename issue above. Verify
concretely (fetch the workflow file via the API, confirm the exact ref it's
on, confirm default branch, confirm Actions permissions) before pattern-
matching to "probably an account restriction."

## Do

- Trigger real Framer writes via GitHub Actions (`workflow_dispatch`), not
  from a local/sandboxed shell, unless you've confirmed that shell can
  actually reach `framer.com`.
- Run `npm test` after any `src/` change -- it's fast, offline, and every
  behavior it doesn't cover is a behavior nobody's checked.
- Use `dry-run` / `dry-run-full` before a real `sync` when you've changed
  extraction or diffing logic, and read the plan before trusting it.
- Use `npm run audit` (report-only) before `audit:apply` -- confirm what
  it found is actually orphaned data, not something legitimate.
- Re-verify branch/default-branch state with `git ls-remote --symref` after
  any repo settings change, before assuming a push landed where you think.

## Don't

- Don't delete or bypass the "removal archives, it does not delete" rule
  without the user explicitly asking to change it -- it's load-bearing
  (see `CLAUDE.md`).
- Don't lower or remove the row-count guard to make an extraction "just
  work" -- if it's tripping, something upstream actually broke; fix that,
  don't silence the guard.
- Don't change `sync-schedule.json`'s cadence on your own judgment --
  that's a product decision for the user to make explicitly.
- Don't commit `.env` or print its contents. Verify with
  `git check-ignore -v .env` before a first commit in a fresh clone.
- Don't guess a Framer collection name -- it must match exactly
  (case-sensitive) what's already in the user's project, or `setup` will
  create a duplicate collection instead of reusing theirs. Ask if unsure.
- Don't retry a network call to a host a sandbox proxy has already reported
  as policy-blocked (403/407) -- report it and route the real write through
  GitHub Actions instead.

## Where things actually are

- Real source of truth for the sync logic: `src/` (see `CLAUDE.md`'s
  "Layout" section for the full map).
- Real source of truth for *why* a rule exists: `CLAUDE.md`'s "Domain
  rules" section. If a change would violate one of those, stop and ask
  before proceeding, even if it would make a symptom go away.
- The actual Framer collection this project targets is named **Problems**
  (`src/config.js`'s `COLLECTION_NAME`) -- not the "Math Problem Bank"
  collection that exists from an early mistake in this project's history
  and was never cleaned up programmatically (Framer's API has no
  delete-collection call `framer-api` exposes; it needs manual deletion in
  Framer's UI, which the user was asked to do but the tooling can't verify).

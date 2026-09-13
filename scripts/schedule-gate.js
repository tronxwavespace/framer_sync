#!/usr/bin/env node
// Runs on every scheduled tick (see .github/workflows/sync.yml). Decides
// whether a sync is actually due yet, based on sync-schedule.json -- so
// the cadence can be changed anytime by editing that one file, without
// touching the workflow's cron expression.
import { readFileSync, appendFileSync } from "node:fs"
import { join } from "node:path"
import { PROJECT_ROOT } from "../src/env.js"
import { isSyncDue, isValidInterval, INTERVAL_MS } from "../src/schedule.js"

async function lastScheduledRunAt({ owner, repo, token }) {
    const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/sync.yml/runs?event=schedule&status=success&per_page=1`
    const res = await fetch(url, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
        },
    })
    if (!res.ok) {
        throw new Error(`GitHub API error listing past runs: ${res.status} ${res.statusText}`)
    }
    const data = await res.json()
    const run = data.workflow_runs?.[0]
    return run ? new Date(run.created_at) : null
}

async function main() {
    const configPath = join(PROJECT_ROOT, "sync-schedule.json")
    const config = JSON.parse(readFileSync(configPath, "utf8"))
    if (!isValidInterval(config.interval)) {
        throw new Error(
            `sync-schedule.json: unknown interval "${config.interval}". Use one of: ${Object.keys(INTERVAL_MS).join(", ")}`,
        )
    }

    const [owner, repo] = (process.env.GITHUB_REPOSITORY || "").split("/")
    const token = process.env.GITHUB_TOKEN
    if (!owner || !repo || !token) {
        throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN must be set (this only runs inside GitHub Actions).")
    }

    const lastRunAt = await lastScheduledRunAt({ owner, repo, token })
    const { due, dueAt } = isSyncDue({ lastRunAt, interval: config.interval, now: new Date() })

    console.log(`Sync schedule: every ${config.interval} (see sync-schedule.json).`)
    console.log(lastRunAt ? `Last scheduled sync: ${lastRunAt.toISOString()}` : "No previous scheduled sync found.")
    console.log(due ? "Due now -- proceeding." : `Not due until ${dueAt.toISOString()} -- skipping this tick.`)

    const outputPath = process.env.GITHUB_OUTPUT
    if (outputPath) {
        appendFileSync(outputPath, `should_run=${due}\n`)
    }
}

main().catch((err) => {
    console.error(err.stack ?? String(err))
    process.exit(1)
})

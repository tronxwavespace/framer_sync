import { appendFileSync } from "node:fs"
import { planSummary } from "./plan.js"

export function formatPlanText(plan, { dryRun } = {}) {
    const s = planSummary(plan)
    const lines = [
        dryRun ? "Dry run -- no changes will be written." : "Sync plan:",
        `  create:    ${s.creates}`,
        `  update:    ${s.updates}`,
        `  unchanged: ${s.unchanged}`,
        `  archive:   ${s.archives}`,
        `  total:     ${s.total}`,
    ]
    if (plan.creates.length > 0) {
        lines.push("", "Creating:", ...plan.creates.map((r) => `  + ${r.problemId} ${r.title}`))
    }
    if (plan.updates.length > 0) {
        lines.push("", "Updating:", ...plan.updates.map(({ row }) => `  ~ ${row.problemId} ${row.title}`))
    }
    if (plan.archives.length > 0) {
        lines.push("", "Archiving:", ...plan.archives.map((a) => `  - ${a.problemId}`))
    }
    return lines.join("\n")
}

export function printPlan(plan, opts) {
    console.log(formatPlanText(plan, opts))
}

export function writeJobSummary(markdown) {
    const path = process.env.GITHUB_STEP_SUMMARY
    if (!path) return false
    appendFileSync(path, markdown + "\n")
    return true
}

export function planToMarkdown(plan, { dryRun, published } = {}) {
    const s = planSummary(plan)
    const lines = [
        `## Framer sync ${dryRun ? "(dry run)" : "result"}`,
        "",
        "| Action | Count |",
        "| --- | --- |",
        `| Create | ${s.creates} |`,
        `| Update | ${s.updates} |`,
        `| Unchanged | ${s.unchanged} |`,
        `| Archive | ${s.archives} |`,
    ]
    if (!dryRun && published !== undefined) {
        lines.push("", published ? "Published a preview." : "Skipped publishing (--no-publish).")
    }
    return lines.join("\n")
}

/**
 * Pure diff between the desired rows (from the validated source data) and
 * the existing Framer collection items. No network, no file I/O -- this is
 * what makes a dry run trustworthy: it computes the plan exactly the way
 * the real run would.
 *
 * @param {Array} desiredRows - validated rows (see src/validate.js)
 * @param {Array} existingItems - [{ frameItemId, problemId, slug, syncHash, syncStatus }]
 * @param {Iterable<string>} scopeIds - the universe of problem ids this run
 *   is responsible for; existing Active items in this scope that are absent
 *   from desiredRows are archived. Items outside scope are left untouched.
 */
export function buildPlan(desiredRows, existingItems, scopeIds) {
    const scope = new Set(scopeIds)
    const existingByProblemId = new Map(existingItems.map((item) => [item.problemId, item]))
    const desiredIds = new Set(desiredRows.map((row) => row.problemId))

    const creates = []
    const updates = []
    const unchanged = []

    for (const row of desiredRows) {
        const existing = existingByProblemId.get(row.problemId)
        if (!existing) {
            creates.push(row)
            continue
        }
        if (existing.syncStatus === "Archived" || existing.syncHash !== row.contentHash) {
            updates.push({ row, frameItemId: existing.frameItemId })
            continue
        }
        unchanged.push(row)
    }

    const archives = []
    for (const item of existingItems) {
        if (!scope.has(item.problemId)) continue
        if (item.syncStatus === "Archived") continue
        if (desiredIds.has(item.problemId)) continue
        archives.push({ frameItemId: item.frameItemId, problemId: item.problemId })
    }

    return { creates, updates, unchanged, archives }
}

export function planSummary(plan) {
    return {
        creates: plan.creates.length,
        updates: plan.updates.length,
        unchanged: plan.unchanged.length,
        archives: plan.archives.length,
        total: plan.creates.length + plan.updates.length + plan.unchanged.length + plan.archives.length,
    }
}

export function isNoop(plan) {
    return plan.creates.length === 0 && plan.updates.length === 0 && plan.archives.length === 0
}

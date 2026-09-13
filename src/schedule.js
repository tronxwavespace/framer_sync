export const INTERVAL_MS = {
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000,
}

export function isValidInterval(interval) {
    return Object.prototype.hasOwnProperty.call(INTERVAL_MS, interval)
}

/**
 * Pure: given when the last scheduled sync completed (or null if there
 * hasn't been one) and the configured interval, decide whether a new sync
 * is due right now. This is what makes the schedule editable anytime --
 * the cron trigger itself just needs to tick at least as often as the
 * shortest interval on offer ("hour"); this function decides whether that
 * tick should actually do anything.
 */
export function isSyncDue({ lastRunAt, interval, now = new Date() }) {
    if (!isValidInterval(interval)) {
        throw new Error(`Unknown sync interval "${interval}". Use one of: ${Object.keys(INTERVAL_MS).join(", ")}`)
    }
    if (!lastRunAt) {
        return { due: true, dueAt: now }
    }
    const dueAt = new Date(lastRunAt.getTime() + INTERVAL_MS[interval])
    return { due: now >= dueAt, dueAt }
}

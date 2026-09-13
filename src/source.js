import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Fetch a file's raw contents from GitHub (unauthenticated, raw.githubusercontent.com
 * so it works the same in CI and in restricted network sandboxes that only allow
 * anonymous git/raw reads).
 */
export async function fetchGitHubFile({ owner, repo, ref, path }) {
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`
    const res = await fetch(url)
    if (!res.ok) {
        throw new Error(`GitHub fetch failed for ${path}: ${res.status} ${res.statusText}`)
    }
    return res.text()
}

export function readLocalFile({ localDir, path }) {
    return readFileSync(join(localDir, path), "utf8")
}

// --- RFC 4180 CSV ---------------------------------------------------------

/**
 * Parse RFC 4180 CSV text into an array of objects keyed by the header row.
 * Handles quoted fields, embedded commas, embedded newlines, and doubled
 * quotes as escapes.
 */
export function parseCsv(text) {
    const rows = parseCsvRows(text)
    if (rows.length === 0) return []
    const [header, ...body] = rows
    return body
        .filter((row) => row.length > 1 || (row.length === 1 && row[0] !== ""))
        .map((row) => {
            const obj = {}
            header.forEach((key, i) => {
                obj[key] = row[i] ?? ""
            })
            return obj
        })
}

function parseCsvRows(text) {
    const rows = []
    let row = []
    let field = ""
    let inQuotes = false
    let i = 0
    const n = text.length

    while (i < n) {
        const ch = text[i]

        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    field += '"'
                    i += 2
                    continue
                }
                inQuotes = false
                i += 1
                continue
            }
            field += ch
            i += 1
            continue
        }

        if (ch === '"') {
            inQuotes = true
            i += 1
            continue
        }
        if (ch === ",") {
            row.push(field)
            field = ""
            i += 1
            continue
        }
        if (ch === "\r") {
            i += 1
            continue
        }
        if (ch === "\n") {
            row.push(field)
            rows.push(row)
            row = []
            field = ""
            i += 1
            continue
        }
        field += ch
        i += 1
    }

    if (field !== "" || row.length > 0) {
        row.push(field)
        rows.push(row)
    }

    return rows
}

function csvEscape(value) {
    const str = value === undefined || value === null ? "" : String(value)
    if (/[",\r\n]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`
    }
    return str
}

/**
 * Serialize an array of plain objects (all sharing the same keys as the
 * first object) into RFC 4180 CSV text.
 */
export function toCsv(rows) {
    if (rows.length === 0) return ""
    const header = Object.keys(rows[0])
    const lines = [header.map(csvEscape).join(",")]
    for (const row of rows) {
        lines.push(header.map((key) => csvEscape(row[key])).join(","))
    }
    return lines.join("\r\n") + "\r\n"
}

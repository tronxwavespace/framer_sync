#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { PROJECT_ROOT } from "../src/env.js"
import { SOURCE, STARTER_PROBLEM_IDS, GUARDS, STATUS_CASES, ELIGIBLE_CASES } from "../src/config.js"
import { fetchGitHubFile, readLocalFile, toCsv } from "../src/source.js"
import { validateRows } from "../src/validate.js"

function parseArgs(argv) {
    const args = { starter: false, limit: null, status: null, eligible: null, only: null, local: null, minRows: null }
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === "--starter") args.starter = true
        else if (arg === "--limit") args.limit = Number(argv[++i])
        else if (arg === "--status") args.status = argv[++i]
        else if (arg === "--eligible") args.eligible = argv[++i]
        else if (arg === "--only") args.only = argv[++i].split(",").map((s) => s.trim())
        else if (arg === "--local") args.local = argv[++i]
        else if (arg === "--min-rows") args.minRows = Number(argv[++i])
    }
    return args
}

const FIELD_LABEL_MAP = {
    "date proposed": "dateProposed",
    "mathematical area": "mathematicalArea",
    "problem description": "problemDescription",
    "current status": "statusRaw",
    "lean proof": "leanProofRaw",
    "eligible to claim": "eligibleRaw",
    "historical bounty": "historicalBounty",
    "elapsed years (as recorded)": "elapsedYears",
    "independent verification": "independentVerification",
    "publication details": "publicationDetails",
    "public review": "publicReview",
}

function extractTable(lines, startIdx) {
    const rows = []
    for (let i = startIdx + 2; i < lines.length; i++) {
        const trimmed = lines[i].trim()
        if (!trimmed.startsWith("|")) break
        const m = /^\|\s*(.*?)\s*\|\s*(.*)\|\s*$/.exec(trimmed)
        if (!m) break
        rows.push([m[1].trim(), m[2].trim()])
    }
    return rows
}

function findTableStart(lines, fromIdx) {
    for (let i = fromIdx; i < lines.length; i++) {
        if (/^\|\s*Field/i.test(lines[i].trim())) return i
    }
    return -1
}

export function splitIntoBlocks(markdown) {
    const anchorRe = /<a id="(JSP-\d{6})"><\/a>/g
    const matches = [...markdown.matchAll(anchorRe)]
    const blocks = []
    for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index + matches[i][0].length
        const end = i + 1 < matches.length ? matches[i + 1].index : markdown.length
        blocks.push({ id: matches[i][1], text: markdown.slice(start, end) })
    }
    return blocks
}

export function parseBlock(id, text, catalogFile) {
    const lines = text.split("\n")

    const headingLine = lines.find((l) => l.trim().startsWith("## "))
    const headingMatch = headingLine ? /^##\s+\S+\s*[··]\s*(.+)$/.exec(headingLine.trim()) : null
    const title = headingMatch ? headingMatch[1].trim() : ""

    const reviewIdx = lines.findIndex((l) => l.trim().toLowerCase() === "### review notes")

    const fieldTableEnd = reviewIdx === -1 ? lines.length : reviewIdx
    const fieldTableStart = findTableStart(lines.slice(0, fieldTableEnd), 0)
    const fieldRows = fieldTableStart === -1 ? [] : extractTable(lines.slice(0, fieldTableEnd), fieldTableStart)

    const row = { id, catalogFile, title }
    for (const [label, value] of fieldRows) {
        const key = FIELD_LABEL_MAP[label.toLowerCase()]
        if (key) row[key] = value
    }

    if (reviewIdx !== -1) {
        const reviewTableStart = findTableStart(lines, reviewIdx)
        const reviewRows = reviewTableStart === -1 ? [] : extractTable(lines, reviewTableStart)
        row.reviewNotes = reviewRows.map(([label, note]) => `${label}: ${note}`).join("\n\n")
    } else {
        row.reviewNotes = ""
    }

    return row
}

async function loadCatalog(file, { local }) {
    const text = local
        ? readLocalFile({ localDir: local, path: file })
        : await fetchGitHubFile({ owner: SOURCE.owner, repo: SOURCE.repo, ref: SOURCE.ref, path: `problems/${file}` })
    return splitIntoBlocks(text).map((b) => parseBlock(b.id, b.text, file))
}

export async function extractAll({ local } = {}) {
    const rows = []
    for (const file of SOURCE.catalogFiles) {
        const parsed = await loadCatalog(file, { local })
        rows.push(...parsed)
    }
    return rows
}

function applyFilters(rows, args) {
    let filtered = rows

    if (args.starter) {
        const idSet = new Set(STARTER_PROBLEM_IDS)
        filtered = filtered.filter((r) => idSet.has(r.id))
    } else if (args.only) {
        const idSet = new Set(args.only)
        filtered = filtered.filter((r) => idSet.has(r.id))
    }

    if (args.status) {
        filtered = filtered.filter((r) => (r.statusRaw || "").split(/<br\s*\/?>/i)[0].trim().startsWith(args.status))
    }
    if (args.eligible) {
        filtered = filtered.filter((r) => (r.eligibleRaw || "").trim() === args.eligible)
    }
    if (args.limit) {
        filtered = filtered.slice(0, args.limit)
    }

    return filtered
}

export function determineScope(args, ids) {
    if (args.starter || args.only) return { mode: args.starter ? "starter" : "only", ids }
    if (args.limit || args.status || args.eligible) return { mode: "filtered", ids }
    return { mode: "all", ids }
}

async function main() {
    const args = parseArgs(process.argv.slice(2))

    if (args.status && !STATUS_CASES.includes(args.status)) {
        console.error(`--status must be one of: ${STATUS_CASES.join(", ")}`)
        process.exit(1)
    }
    if (args.eligible && !ELIGIBLE_CASES.includes(args.eligible)) {
        console.error(`--eligible must be one of: ${ELIGIBLE_CASES.join(", ")}`)
        process.exit(1)
    }

    console.log(
        args.local
            ? `Reading local catalogs from ${args.local} ...`
            : `Fetching catalogs from github.com/${SOURCE.owner}/${SOURCE.repo}@${SOURCE.ref} ...`,
    )

    const allRows = await extractAll({ local: args.local })
    console.log(`Parsed ${allRows.length} problems from ${SOURCE.catalogFiles.length} catalog files.`)

    const filtered = applyFilters(allRows, args)

    if (args.starter || args.only) {
        const requested = args.starter ? STARTER_PROBLEM_IDS : args.only
        const found = new Set(filtered.map((r) => r.id))
        const missing = requested.filter((id) => !found.has(id))
        if (missing.length > 0) {
            console.error(`Requested id(s) not found in source: ${missing.join(", ")}`)
            process.exit(1)
        }
    }

    const minRows = args.minRows ?? GUARDS.minRows
    if (filtered.length < minRows) {
        console.error(
            `Row-count guard failed: extracted ${filtered.length} rows, expected at least ${minRows}. ` +
                `Refusing to write a possibly half-failed extraction.`,
        )
        process.exit(1)
    }

    // Validate before writing anything -- a bad source file must never
    // produce a half-written data directory.
    validateRows(filtered)

    const dataDir = join(PROJECT_ROOT, "data")
    mkdirSync(dataDir, { recursive: true })

    writeFileSync(join(dataDir, "problems.csv"), toCsv(filtered))
    writeFileSync(join(dataDir, "problems.json"), JSON.stringify(filtered, null, 4) + "\n")

    const scope = determineScope(args, filtered.map((r) => r.id))
    const manifest = {
        generatedAt: new Date().toISOString(),
        source: SOURCE,
        scope,
        rowCount: filtered.length,
    }
    writeFileSync(join(dataDir, "problems.manifest.json"), JSON.stringify(manifest, null, 4) + "\n")

    console.log(`Wrote ${filtered.length} rows to data/problems.csv, data/problems.json, data/problems.manifest.json`)
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`
if (isMain) {
    main().catch((err) => {
        console.error(err.stack ?? String(err))
        process.exit(1)
    })
}

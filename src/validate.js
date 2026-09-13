import { createHash } from "node:crypto"
import { STATUS_CASES, LEAN_PROOF_CASES, ELIGIBLE_CASES, SOURCE, TOTAL_PROBLEMS } from "./config.js"

export class ValidationError extends Error {
    constructor(issues) {
        super(`${issues.length} row(s) failed validation:\n` + issues.map((i) => `  - ${i}`).join("\n"))
        this.name = "ValidationError"
        this.issues = issues
    }
}

const ID_PATTERN = /^JSP-(\d{6})$/

/**
 * True if `id` matches JSP-###### and falls within the catalog's known
 * range (1..totalProblems). Used to recognize CMS items that don't
 * correspond to any real source problem -- e.g. a manually created test
 * item -- so they can be archived instead of left as orphans.
 */
export function isValidProblemId(id, totalProblems = TOTAL_PROBLEMS) {
    const match = ID_PATTERN.exec(id)
    if (!match) return false
    const n = Number(match[1])
    return n >= 1 && n <= totalProblems
}

const REQUIRED_FIELDS = [
    "id",
    "title",
    "dateProposed",
    "mathematicalArea",
    "problemDescription",
    "statusRaw",
    "leanProofRaw",
    "eligibleRaw",
    "catalogFile",
]

function slugify(text) {
    return text
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80)
        .replace(/-+$/g, "")
}

function firstSegment(text) {
    return text.split(/<br\s*\/?>/i)[0].trim()
}

function classify(text, allowedPrefixes, label, id, issues) {
    const segment = firstSegment(text)
    const match = allowedPrefixes.find((prefix) => new RegExp(`^${prefix}\\b`).test(segment))
    if (!match) {
        issues.push(`${id}: unrecognized ${label} value "${segment}"`)
        return null
    }
    return match
}

function detail(text) {
    return text.replace(/<br\s*\/?>/gi, "\n").trim()
}

export function computeContentHash(row) {
    const material = [
        row.title,
        row.catalogNumber,
        row.dateProposed,
        row.mathematicalArea,
        row.problemDescription,
        row.status,
        row.statusDetail,
        row.leanProof,
        row.leanProofDetail,
        row.eligible,
        row.historicalBounty,
        row.elapsedYears,
        row.independentVerification,
        row.publicationDetails,
        row.publicReview,
        row.reviewNotes,
        row.catalogFile,
        row.sourceUrl,
    ].join("")
    return createHash("sha256").update(material).digest("hex")
}

/**
 * Validate and coerce raw extracted rows. Throws ValidationError listing
 * every problem found, rather than stopping at the first one -- nothing
 * should be written to Framer until every row passes.
 */
export function validateRows(rawRows) {
    const issues = []
    const seenIds = new Set()
    const rows = []

    for (const raw of rawRows) {
        const id = (raw.id || "").trim()
        const rowLabel = id || "(missing id)"

        for (const field of REQUIRED_FIELDS) {
            if (!raw[field] || String(raw[field]).trim() === "") {
                issues.push(`${rowLabel}: missing required field "${field}"`)
            }
        }

        if (!id) continue

        const idMatch = ID_PATTERN.exec(id)
        if (!idMatch) {
            issues.push(`${id}: id must match JSP-###### (e.g. JSP-000001)`)
            continue
        }

        if (seenIds.has(id)) {
            issues.push(`${id}: duplicate id`)
            continue
        }
        seenIds.add(id)

        const status = classify(raw.statusRaw || "", STATUS_CASES, "status", id, issues)
        const leanProof = classify(raw.leanProofRaw || "", LEAN_PROOF_CASES, "Lean proof", id, issues)
        const eligible = (raw.eligibleRaw || "").trim()
        if (!ELIGIBLE_CASES.includes(eligible)) {
            issues.push(`${id}: unrecognized eligible value "${eligible}"`)
        }

        if (status === null || leanProof === null || !ELIGIBLE_CASES.includes(eligible)) {
            continue
        }

        const title = raw.title.trim()
        const catalogNumber = Number(idMatch[1])
        const catalogFile = raw.catalogFile.trim()

        const row = {
            problemId: id,
            title,
            catalogNumber,
            dateProposed: raw.dateProposed.trim(),
            mathematicalArea: raw.mathematicalArea.trim(),
            problemDescription: raw.problemDescription.trim(),
            status,
            statusDetail: detail(raw.statusRaw),
            leanProof,
            leanProofDetail: detail(raw.leanProofRaw),
            eligible,
            historicalBounty: (raw.historicalBounty || "").trim(),
            elapsedYears: (raw.elapsedYears || "").trim(),
            independentVerification: (raw.independentVerification || "").trim(),
            publicationDetails: (raw.publicationDetails || "").trim(),
            publicReview: (raw.publicReview || "").trim(),
            reviewNotes: (raw.reviewNotes || "").trim(),
            catalogFile,
            sourceUrl: `https://github.com/${SOURCE.owner}/${SOURCE.repo}/blob/${SOURCE.ref}/problems/${catalogFile}#${id}`,
            slug: `${id.toLowerCase()}-${slugify(title)}`,
        }
        row.contentHash = computeContentHash(row)

        rows.push(row)
    }

    if (issues.length > 0) {
        throw new ValidationError(issues)
    }

    return rows
}

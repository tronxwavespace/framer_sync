import { loadEnv } from "./env.js"

export const SOURCE = {
    owner: "TheJustinSunPrize",
    repo: "awards",
    ref: "main",
    catalogFiles: [
        "catalog-0001-0100.md",
        "catalog-0101-0200.md",
        "catalog-0201-0300.md",
        "catalog-0301-0400.md",
        "catalog-0401-0500.md",
        "catalog-0501-0600.md",
        "catalog-0601-0700.md",
        "catalog-0701-0800.md",
        "catalog-0801-0900.md",
        "catalog-0901-1000.md",
        "catalog-1001-1022.md",
    ],
}

// A fixed, deliberately varied subset (open, solved+eligible, solved-but-not-eligible,
// progress, partial-Lean, conditional-Lean) while the Framer pages are being built.
export const STARTER_PROBLEM_IDS = [
    "JSP-000001",
    "JSP-000005",
    "JSP-000007",
    "JSP-000010",
    "JSP-000037",
    "JSP-000038",
    "JSP-000041",
    "JSP-000066",
]

export const STATUS_CASES = ["Open", "Solved", "Progress"]
export const LEAN_PROOF_CASES = ["Yes", "No", "Partial", "Conditional", "Pending", "Reported"]
export const ELIGIBLE_CASES = ["Yes", "No", "Pending verification"]
export const SYNC_STATUS_CASES = ["Active", "Archived"]

export const COLLECTION_NAME = "Math Problem Bank"

// The 21 fields written into the Framer collection. `key` is the internal
// row property name; `name` is what setup-collection.js creates in Framer.
export const FIELD_DEFINITIONS = [
    { key: "problemId", name: "Problem ID", type: "string" },
    { key: "title", name: "Title", type: "string" },
    { key: "catalogNumber", name: "Catalog Number", type: "number" },
    { key: "dateProposed", name: "Date Proposed", type: "string" },
    { key: "mathematicalArea", name: "Mathematical Area", type: "string" },
    { key: "problemDescription", name: "Problem Description", type: "string" },
    { key: "status", name: "Status", type: "enum", cases: STATUS_CASES },
    { key: "statusDetail", name: "Status Detail", type: "string" },
    { key: "leanProof", name: "Lean Proof", type: "enum", cases: LEAN_PROOF_CASES },
    { key: "leanProofDetail", name: "Lean Proof Detail", type: "string" },
    { key: "eligible", name: "Eligible to Claim", type: "enum", cases: ELIGIBLE_CASES },
    { key: "historicalBounty", name: "Historical Bounty", type: "string" },
    { key: "elapsedYears", name: "Elapsed Years", type: "string" },
    { key: "independentVerification", name: "Independent Verification", type: "string" },
    { key: "publicationDetails", name: "Publication Details", type: "string" },
    { key: "publicReview", name: "Public Review", type: "string" },
    { key: "reviewNotes", name: "Review Notes", type: "string" },
    { key: "catalogFile", name: "Catalog File", type: "string" },
    { key: "sourceUrl", name: "Source URL", type: "link" },
    { key: "syncStatus", name: "Sync Status", type: "enum", cases: SYNC_STATUS_CASES },
    { key: "syncHash", name: "Sync Hash", type: "string" },
]

export const GUARDS = {
    // Minimum acceptable row count for an extraction run. Matches the current
    // 8-problem starter scope. Raise this to 900 when going full (`npm run
    // extract` against all 1,022) -- otherwise a half-failed extractor that
    // silently drops hundreds of problems would still clear this guard.
    minRows: 8,
}

export const BATCH_SIZE = 50

export function loadConfig({ requireFramerCredentials = true } = {}) {
    loadEnv()

    const apiKey = process.env.FRAMER_API_KEY
    const projectUrl = process.env.FRAMER_PROJECT_URL

    if (requireFramerCredentials && (!apiKey || !projectUrl)) {
        const missing = []
        if (!apiKey) missing.push("FRAMER_API_KEY")
        if (!projectUrl) missing.push("FRAMER_PROJECT_URL")
        throw new ConfigError(
            `Missing required environment variable(s): ${missing.join(", ")}. ` +
                `Copy .env.example to .env and fill them in.`,
        )
    }

    if (FIELD_DEFINITIONS.length !== 21) {
        throw new ConfigError(
            `FIELD_DEFINITIONS must have exactly 21 fields, has ${FIELD_DEFINITIONS.length}.`,
        )
    }

    return {
        apiKey,
        projectUrl,
        source: SOURCE,
        collectionName: COLLECTION_NAME,
        fields: FIELD_DEFINITIONS,
        guards: GUARDS,
        batchSize: BATCH_SIZE,
    }
}

export class ConfigError extends Error {
    constructor(message) {
        super(message)
        this.name = "ConfigError"
    }
}

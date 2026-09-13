#!/usr/bin/env node
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { parseCsv, toCsv } from "../src/source.js"
import { validateRows, ValidationError, computeContentHash } from "../src/validate.js"
import { buildPlan, isNoop, planSummary } from "../src/plan.js"
import {
    createClient,
    ensureCollection,
    ensureFields,
    detectSchemaDrift,
    buildFieldMap,
    buildFieldData,
    getExistingItems,
    applyPlan,
    SchemaDriftError,
} from "../src/framer.js"
import { FIELD_DEFINITIONS, STATUS_CASES } from "../src/config.js"
import { formatPlanText, planToMarkdown } from "../src/report.js"
import { loadEnv, checkNodeVersion } from "../src/env.js"
import { splitIntoBlocks, parseBlock, determineScope } from "../scripts/extract-problems.js"
import { runSync, EXIT_OK, EXIT_SCHEMA_ERROR, EXIT_VALIDATION_ERROR } from "../src/sync.js"
import { createFakeConnect } from "./fake-framer.js"

let assertions = 0
let failures = 0
let currentTest = ""

function check(condition, message) {
    assertions += 1
    if (!condition) {
        failures += 1
        console.error(`  FAIL [${currentTest}] ${message}`)
    }
}

const tests = []
function test(name, fn) {
    tests.push({ name, fn })
}

// ---------------------------------------------------------------------------
// CSV edge cases
// ---------------------------------------------------------------------------

test("csv: round-trips plain rows", () => {
    const rows = [{ a: "1", b: "hello" }, { a: "2", b: "world" }]
    const parsed = parseCsv(toCsv(rows))
    check(parsed.length === 2, "expected 2 rows back")
    check(parsed[0].a === "1" && parsed[0].b === "hello", "row 0 round-trips")
    check(parsed[1].b === "world", "row 1 round-trips")
})

test("csv: handles embedded commas, quotes, and newlines", () => {
    const rows = [{ a: 'has, a comma', b: 'has "quotes"', c: "line1\nline2" }]
    const csv = toCsv(rows)
    const parsed = parseCsv(csv)
    check(parsed.length === 1, "one row parsed back")
    check(parsed[0].a === "has, a comma", "comma preserved")
    check(parsed[0].b === 'has "quotes"', "quotes preserved")
    check(parsed[0].c === "line1\nline2", "embedded newline preserved")
})

test("csv: ignores trailing blank line", () => {
    const parsed = parseCsv("a,b\r\n1,2\r\n")
    check(parsed.length === 1, "no phantom trailing row")
})

// ---------------------------------------------------------------------------
// Markdown catalog extraction
// ---------------------------------------------------------------------------

const SAMPLE_MARKDOWN = `# Catalog

<a id="JSP-000001"></a>

## JSP-000001 · Sample open problem

| Field | Content |
| --- | --- |
| Date proposed | 1900 |
| Mathematical area | Test area |
| Problem description | Does this parse correctly? |
| Current status | Open |
| Lean proof | No |
| Eligible to claim | No |

<a id="JSP-000002"></a>

## JSP-000002 · Sample solved problem

| Field | Content |
| --- | --- |
| Date proposed | 2000 |
| Mathematical area | Test area two |
| Problem description | A description, with a comma and a "quote". |
| Current status | Solved<br>Announced by Nobody |
| Lean proof | Yes — [source](https://example.com/a\\|b) |
| Eligible to claim | Yes |
| Independent verification | Reviewed by a bot |

### Review notes

| Field · Review | Note |
| --- | --- |
| Lean proof · check | Looks fine |
`

test("extract: splits catalog markdown into per-problem blocks", () => {
    const blocks = splitIntoBlocks(SAMPLE_MARKDOWN)
    check(blocks.length === 2, "found 2 problem blocks")
    check(blocks[0].id === "JSP-000001", "first block id")
    check(blocks[1].id === "JSP-000002", "second block id")
})

test("extract: parses the field table", () => {
    const blocks = splitIntoBlocks(SAMPLE_MARKDOWN)
    const row1 = parseBlock(blocks[0].id, blocks[0].text, "sample.md")
    check(row1.title === "Sample open problem", "title parsed")
    check(row1.dateProposed === "1900", "dateProposed parsed")
    check(row1.statusRaw === "Open", "statusRaw parsed")
    check(row1.reviewNotes === "", "no review notes on block without the section")
})

test("extract: parses <br>-joined detail and a table cell containing a pipe", () => {
    const blocks = splitIntoBlocks(SAMPLE_MARKDOWN)
    const row2 = parseBlock(blocks[1].id, blocks[1].text, "sample.md")
    check(row2.statusRaw.startsWith("Solved"), "statusRaw starts with Solved")
    check(row2.statusRaw.includes("<br>"), "statusRaw keeps the <br> separator for validate.js to split on")
    check(row2.leanProofRaw.includes("source"), "cell content survived despite an embedded pipe")
    check(row2.independentVerification === "Reviewed by a bot", "optional field captured when present")
})

test("extract: captures the review notes table", () => {
    const blocks = splitIntoBlocks(SAMPLE_MARKDOWN)
    const row2 = parseBlock(blocks[1].id, blocks[1].text, "sample.md")
    check(row2.reviewNotes.includes("Lean proof · check"), "review note label captured")
    check(row2.reviewNotes.includes("Looks fine"), "review note content captured")
})

test("extract: determineScope reports the right mode", () => {
    check(determineScope({ starter: true }, ["a"]).mode === "starter", "starter mode")
    check(determineScope({ only: ["a"] }, ["a"]).mode === "only", "only mode")
    check(determineScope({ limit: 5 }, ["a"]).mode === "filtered", "limit implies filtered mode")
    check(determineScope({}, ["a"]).mode === "all", "no flags means all")
})

// ---------------------------------------------------------------------------
// validate.js
// ---------------------------------------------------------------------------

function rawRow(overrides = {}) {
    return {
        id: "JSP-000001",
        catalogFile: "catalog-0001-0100.md",
        title: "Riemann hypothesis",
        dateProposed: "1859",
        mathematicalArea: "Analytic number theory",
        problemDescription: "Do all nontrivial zeros have real part one half?",
        statusRaw: "Open",
        leanProofRaw: "No",
        eligibleRaw: "No",
        historicalBounty: "USD 1,000,000",
        elapsedYears: "167 years",
        independentVerification: "",
        publicationDetails: "",
        publicReview: "",
        reviewNotes: "",
        ...overrides,
    }
}

test("validate: accepts a well-formed row and classifies fields", () => {
    const [row] = validateRows([rawRow()])
    check(row.status === "Open", "status classified")
    check(row.leanProof === "No", "leanProof classified")
    check(row.eligible === "No", "eligible passthrough")
    check(row.slug === "jsp-000001-riemann-hypothesis", "slug is id-prefixed and slugified")
    check(row.catalogNumber === 1, "catalogNumber parsed from id")
    check(typeof row.contentHash === "string" && row.contentHash.length === 64, "contentHash is a sha256 hex digest")
})

test("validate: classifies compound status/lean-proof text by its first segment", () => {
    const [row] = validateRows([
        rawRow({
            statusRaw: "Progress (not fully resolved)",
            leanProofRaw: "Partial (three-dimensional counterexample only)",
        }),
    ])
    check(row.status === "Progress", "compound status classified to Progress")
    check(row.leanProof === "Partial", "compound lean proof classified to Partial")
    check(row.statusDetail === "Progress (not fully resolved)", "statusDetail keeps the full text")
})

test("validate: splits <br> detail into a clean status and a detail field", () => {
    const [row] = validateRows([
        rawRow({ statusRaw: "Solved<br>Announced by OpenAI (paper P1)" }),
    ])
    check(row.status === "Solved", "clean enum holds only Solved")
    check(row.statusDetail === "Solved\nAnnounced by OpenAI (paper P1)", "detail keeps the full text with <br> as newline")
})

test("validate: rejects a missing required field", () => {
    assert.throws(() => validateRows([rawRow({ title: "" })]), ValidationError)
})

test("validate: rejects a malformed id", () => {
    assert.throws(() => validateRows([rawRow({ id: "JSP-1" })]), ValidationError)
})

test("validate: rejects a duplicate id", () => {
    assert.throws(() => validateRows([rawRow(), rawRow()]), ValidationError)
})

test("validate: rejects unrecognized status/lean-proof/eligible values", () => {
    assert.throws(() => validateRows([rawRow({ statusRaw: "Sideways" })]), ValidationError)
    assert.throws(() => validateRows([rawRow({ leanProofRaw: "Maybe" })]), ValidationError)
    assert.throws(() => validateRows([rawRow({ eligibleRaw: "Sort of" })]), ValidationError)
})

test("validate: aggregates every issue instead of stopping at the first", () => {
    try {
        validateRows([rawRow({ title: "", statusRaw: "Sideways" }), rawRow({ id: "bad-id" })])
        assert.fail("expected ValidationError")
    } catch (err) {
        check(err instanceof ValidationError, "throws ValidationError")
        check(err.issues.length >= 3, `collected multiple issues (got ${err.issues.length})`)
    }
})

test("validate: content hash changes when content changes, stable otherwise", () => {
    const [a] = validateRows([rawRow()])
    const [b] = validateRows([rawRow()])
    const [c] = validateRows([rawRow({ title: "Riemann hypothesis (revised)" })])
    check(a.contentHash === b.contentHash, "identical rows hash identically")
    check(a.contentHash !== c.contentHash, "changed content changes the hash")
})

// ---------------------------------------------------------------------------
// plan.js -- pure diff
// ---------------------------------------------------------------------------

function desiredRow(id, hash) {
    return { problemId: id, title: id, contentHash: hash ?? `hash-${id}` }
}

test("plan: new rows are all creates", () => {
    const plan = buildPlan([desiredRow("JSP-000001"), desiredRow("JSP-000002")], [], ["JSP-000001", "JSP-000002"])
    check(plan.creates.length === 2, "both rows are creates")
    check(plan.updates.length === 0 && plan.archives.length === 0, "no updates or archives")
})

test("plan: matching hash and Active status is unchanged", () => {
    const existing = [{ frameItemId: "f1", problemId: "JSP-000001", slug: "s", syncHash: "hash-JSP-000001", syncStatus: "Active" }]
    const plan = buildPlan([desiredRow("JSP-000001")], existing, ["JSP-000001"])
    check(plan.unchanged.length === 1, "row is unchanged")
    check(isNoop(plan), "a fully unchanged plan is a noop")
})

test("plan: mismatched hash on an Active item is an update", () => {
    const existing = [{ frameItemId: "f1", problemId: "JSP-000001", slug: "s", syncHash: "old-hash", syncStatus: "Active" }]
    const plan = buildPlan([desiredRow("JSP-000001")], existing, ["JSP-000001"])
    check(plan.updates.length === 1, "row is an update")
    check(plan.updates[0].frameItemId === "f1", "update carries the existing Framer item id")
})

test("plan: an Archived item reappearing in the desired set is revived via update", () => {
    const existing = [{ frameItemId: "f1", problemId: "JSP-000001", slug: "s", syncHash: "", syncStatus: "Archived" }]
    const plan = buildPlan([desiredRow("JSP-000001", "")], existing, ["JSP-000001"])
    check(plan.updates.length === 1, "archived-but-matching-hash item is still revived (never silently unchanged)")
})

test("plan: an in-scope Active item missing from desired is archived", () => {
    const existing = [{ frameItemId: "f1", problemId: "JSP-000001", slug: "s", syncHash: "h", syncStatus: "Active" }]
    const plan = buildPlan([], existing, ["JSP-000001"])
    check(plan.archives.length === 1, "missing in-scope item is archived")
    check(plan.archives[0].problemId === "JSP-000001", "archive references the right problem")
})

test("plan: an out-of-scope item missing from desired is left alone", () => {
    const existing = [{ frameItemId: "f1", problemId: "JSP-999999", slug: "s", syncHash: "h", syncStatus: "Active" }]
    const plan = buildPlan([], existing, ["JSP-000001"])
    check(plan.archives.length === 0, "out-of-scope item is not touched")
})

test("plan: an already-Archived item is not archived again", () => {
    const existing = [{ frameItemId: "f1", problemId: "JSP-000001", slug: "s", syncHash: "", syncStatus: "Archived" }]
    const plan = buildPlan([], existing, ["JSP-000001"])
    check(plan.archives.length === 0, "already archived, nothing to do")
})

// ---------------------------------------------------------------------------
// framer.js against the fake client -- schema management
// ---------------------------------------------------------------------------

test("framer: ensureFields creates every field and enum case", async () => {
    const { framer } = createFakeConnect()
    const collection = await framer.createCollection("Test Collection")
    const fieldMap = await ensureFields(collection, FIELD_DEFINITIONS)
    check(Object.keys(fieldMap).length === FIELD_DEFINITIONS.length, "every field mapped")
    check(detectSchemaDrift(await collection.getFields(), FIELD_DEFINITIONS).length === 0, "no drift right after setup")
    check(fieldMap.status.caseIdByName.size === STATUS_CASES.length, "status enum has all its cases")
})

test("framer: ensureFields is idempotent (safe to re-run)", async () => {
    const { framer } = createFakeConnect()
    const collection = await framer.createCollection("Test Collection")
    await ensureFields(collection, FIELD_DEFINITIONS)
    await ensureFields(collection, FIELD_DEFINITIONS)
    const fields = await collection.getFields()
    check(fields.length === FIELD_DEFINITIONS.length, "fields are not duplicated on re-run")
})

test("framer: detectSchemaDrift flags a missing field and a missing enum case", async () => {
    const { framer } = createFakeConnect()
    const collection = await framer.createCollection("Test Collection")
    await ensureFields(collection, FIELD_DEFINITIONS)
    await collection.removeFields([(await collection.getFields()).find((f) => f.name === "Title").id])
    const drift1 = detectSchemaDrift(await collection.getFields(), FIELD_DEFINITIONS)
    check(drift1.some((i) => i.includes("Title")), "missing field detected")

    const { framer: framer2 } = createFakeConnect()
    const collection2 = await framer2.createCollection("Test 2")
    const smallerDefs = FIELD_DEFINITIONS.map((f) =>
        f.key === "status" ? { ...f, cases: ["Open", "Solved"] } : f,
    )
    await ensureFields(collection2, smallerDefs)
    const drift2 = detectSchemaDrift(await collection2.getFields(), FIELD_DEFINITIONS)
    check(drift2.some((i) => i.includes("Progress")), "missing enum case detected")
})

test("framer: buildFieldData rejects an enum value with no matching case", async () => {
    const { framer } = createFakeConnect()
    const collection = await framer.createCollection("Test Collection")
    const fieldMap = await ensureFields(collection, FIELD_DEFINITIONS)
    assert.throws(() => buildFieldData({ status: "NotARealStatus" }, fieldMap), SchemaDriftError)
})

test("framer: getExistingItems normalizes fieldData back into plain values", async () => {
    const { framer } = createFakeConnect()
    const collection = await framer.createCollection("Test Collection")
    const fieldMap = await ensureFields(collection, FIELD_DEFINITIONS)
    await collection.addItems([
        {
            slug: "jsp-000001-test",
            fieldData: {
                [fieldMap.problemId.id]: { type: "string", value: "JSP-000001" },
                [fieldMap.syncHash.id]: { type: "string", value: "abc" },
                [fieldMap.syncStatus.id]: { type: "enum", value: fieldMap.syncStatus.caseIdByName.get("Active") },
            },
        },
    ])
    const [item] = await getExistingItems(collection, fieldMap)
    check(item.problemId === "JSP-000001", "problemId round-trips")
    check(item.syncHash === "abc", "syncHash round-trips")
    check(item.syncStatus === "Active", "enum case id resolved back to its name")
})

// ---------------------------------------------------------------------------
// Full pipeline (sync.js) against the fake Framer client
// ---------------------------------------------------------------------------

function withTempDataDir(rows, manifestOverrides = {}) {
    const dir = mkdtempSync(join(tmpdir(), "framer-sync-test-"))
    writeFileSync(join(dir, "problems.csv"), toCsv(rows))
    const manifest = {
        generatedAt: new Date().toISOString(),
        source: { owner: "TheJustinSunPrize", repo: "awards", ref: "main" },
        scope: { mode: "starter", ids: rows.map((r) => r.id) },
        rowCount: rows.length,
        ...manifestOverrides,
    }
    writeFileSync(join(dir, "problems.manifest.json"), JSON.stringify(manifest))
    return dir
}

function starterRows() {
    return [
        rawRow({ id: "JSP-000001", title: "Riemann hypothesis" }),
        rawRow({ id: "JSP-000005", title: "Navier-Stokes", statusRaw: "Solved", leanProofRaw: "Yes", eligibleRaw: "Yes" }),
    ]
}

async function setUpFakeCollection() {
    const { framer, connectImpl } = createFakeConnect()
    const collection = await ensureCollection(framer, "Math Problem Bank")
    await ensureFields(collection.collection, FIELD_DEFINITIONS)
    return { framer, connectImpl }
}

test("sync: end-to-end create, idempotent re-run, then update", async () => {
    process.env.FRAMER_API_KEY = "test-key"
    process.env.FRAMER_PROJECT_URL = "https://example.test/project"

    const { framer, connectImpl } = await setUpFakeCollection()
    const dir = withTempDataDir(starterRows())

    const first = await runSync({ dataDir: dir, connectImpl })
    check(first.exitCode === EXIT_OK, "first run exits OK")
    check(first.result.created === 2, "first run creates both rows")
    check(framer.publishCount === 1, "auto-deploy published after a non-noop run")

    const second = await runSync({ dataDir: dir, connectImpl })
    check(second.exitCode === EXIT_OK, "second run exits OK")
    check(planSummary(second.plan).unchanged === 2, "idempotent re-run finds nothing to change")
    check(second.result.created === 0 && second.result.updated === 0, "idempotent re-run writes nothing")
    check(framer.publishCount === 1, "a no-op run does not publish again")

    writeFileSync(
        join(dir, "problems.csv"),
        toCsv([rawRow({ id: "JSP-000001", title: "Riemann hypothesis (updated)" }), rawRow({ id: "JSP-000005", title: "Navier-Stokes", statusRaw: "Solved", leanProofRaw: "Yes", eligibleRaw: "Yes" })]),
    )
    const third = await runSync({ dataDir: dir, connectImpl })
    check(third.result.updated === 1, "changed content triggers exactly one update")
    check(framer.publishCount === 2, "a real change publishes again")

    rmSync(dir, { recursive: true, force: true })
})

test("sync: slugs are frozen after creation", async () => {
    process.env.FRAMER_API_KEY = "test-key"
    process.env.FRAMER_PROJECT_URL = "https://example.test/project"
    const { framer, connectImpl } = await setUpFakeCollection()
    const dir = withTempDataDir([rawRow({ id: "JSP-000001", title: "Original Title" })])

    await runSync({ dataDir: dir, connectImpl })
    const collection = (await framer.getCollections())[0]
    const [itemBefore] = await collection.getItems()
    const originalSlug = itemBefore.slug

    writeFileSync(join(dir, "problems.csv"), toCsv([rawRow({ id: "JSP-000001", title: "A Completely Different Title" })]))
    await runSync({ dataDir: dir, connectImpl })
    const [itemAfter] = await collection.getItems()

    check(itemAfter.slug === originalSlug, "slug did not change even though the title (and its slugified form) did")

    rmSync(dir, { recursive: true, force: true })
})

test("sync: archive and revival round-trip", async () => {
    process.env.FRAMER_API_KEY = "test-key"
    process.env.FRAMER_PROJECT_URL = "https://example.test/project"
    const { framer, connectImpl } = await setUpFakeCollection()
    const rows = starterRows()
    const dir = withTempDataDir(rows)

    await runSync({ dataDir: dir, connectImpl })

    // Upstream "removes" JSP-000005 -- only JSP-000001 remains, scope still covers both.
    writeFileSync(join(dir, "problems.csv"), toCsv([rows[0]]))
    writeFileSync(
        join(dir, "problems.manifest.json"),
        JSON.stringify({
            generatedAt: new Date().toISOString(),
            source: { owner: "TheJustinSunPrize", repo: "awards", ref: "main" },
            scope: { mode: "starter", ids: rows.map((r) => r.id) },
            rowCount: 1,
        }),
    )
    const archiveRun = await runSync({ dataDir: dir, connectImpl })
    check(archiveRun.result.archived === 1, "removed-but-in-scope row is archived")

    const collection = (await framer.getCollections())[0]
    const fields = await collection.getFields()
    const syncStatusField = fields.find((f) => f.name === "Sync Status")
    const syncHashField = fields.find((f) => f.name === "Sync Hash")
    const archivedCaseId = syncStatusField.cases.find((c) => c.name === "Archived").id

    const items = await collection.getItems()
    const archivedItem = items.find((it) => it.fieldData[syncHashField.id]?.value === "" || it.fieldData[syncStatusField.id]?.value === archivedCaseId)
    check(archivedItem.fieldData[syncStatusField.id].value === archivedCaseId, "item's Sync Status field is set to Archived")
    check(archivedItem.fieldData[syncHashField.id].value === "", "Sync Hash is cleared so a later revival isn't skipped as unchanged")

    // Upstream brings it back.
    writeFileSync(join(dir, "problems.csv"), toCsv(rows))
    const revivalRun = await runSync({ dataDir: dir, connectImpl })
    check(revivalRun.result.updated === 1, "reappearing row is revived via an update, not left archived")

    rmSync(dir, { recursive: true, force: true })
})

test("sync: --dry-run computes the real plan but writes nothing", async () => {
    process.env.FRAMER_API_KEY = "test-key"
    process.env.FRAMER_PROJECT_URL = "https://example.test/project"
    const { framer, connectImpl } = await setUpFakeCollection()
    const dir = withTempDataDir(starterRows())

    const outcome = await runSync({ dataDir: dir, dryRun: true, connectImpl })
    check(outcome.exitCode === EXIT_OK, "dry run exits OK")
    check(outcome.plan.creates.length === 2, "dry run reports the same plan a real run would")

    const collection = (await framer.getCollections())[0]
    check((await collection.getItems()).length === 0, "dry run writes nothing")
    check(framer.publishCount === 0, "dry run never publishes")

    rmSync(dir, { recursive: true, force: true })
})

test("sync: --no-publish writes changes without auto-deploying", async () => {
    process.env.FRAMER_API_KEY = "test-key"
    process.env.FRAMER_PROJECT_URL = "https://example.test/project"
    const { framer, connectImpl } = await setUpFakeCollection()
    const dir = withTempDataDir(starterRows())

    const outcome = await runSync({ dataDir: dir, publishAfter: false, connectImpl })
    check(outcome.result.created === 2, "rows are still written")
    check(outcome.published === false, "reports that it did not publish")
    check(framer.publishCount === 0, "publish() was never called")

    rmSync(dir, { recursive: true, force: true })
})

test("sync: refuses to run against a collection that hasn't been set up", async () => {
    process.env.FRAMER_API_KEY = "test-key"
    process.env.FRAMER_PROJECT_URL = "https://example.test/project"
    const { connectImpl } = createFakeConnect() // no collection created
    const dir = withTempDataDir(starterRows())

    const outcome = await runSync({ dataDir: dir, connectImpl })
    check(outcome.exitCode === EXIT_SCHEMA_ERROR, "missing collection is a schema error")
    check(outcome.message.includes("npm run setup"), "error tells the operator how to fix it")

    rmSync(dir, { recursive: true, force: true })
})

test("sync: detects schema drift instead of writing to a mismatched collection", async () => {
    process.env.FRAMER_API_KEY = "test-key"
    process.env.FRAMER_PROJECT_URL = "https://example.test/project"
    const { framer, connectImpl } = await setUpFakeCollection()
    const collection = (await framer.getCollections())[0]
    const titleField = (await collection.getFields()).find((f) => f.name === "Title")
    await collection.removeFields([titleField.id])

    const dir = withTempDataDir(starterRows())
    const outcome = await runSync({ dataDir: dir, connectImpl })
    check(outcome.exitCode === EXIT_SCHEMA_ERROR, "schema drift is a schema error")
    check(outcome.message.includes("Title"), "error names the missing field")

    rmSync(dir, { recursive: true, force: true })
})

test("sync: refuses to write anything when a row fails validation", async () => {
    process.env.FRAMER_API_KEY = "test-key"
    process.env.FRAMER_PROJECT_URL = "https://example.test/project"
    const { connectImpl } = await setUpFakeCollection()
    const dir = withTempDataDir([rawRow({ statusRaw: "Not A Real Status" })])

    const outcome = await runSync({ dataDir: dir, connectImpl })
    check(outcome.exitCode === EXIT_VALIDATION_ERROR, "invalid source data is a validation error")

    rmSync(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// env.js / report.js smoke tests
// ---------------------------------------------------------------------------

test("env: checkNodeVersion accepts the running Node", () => {
    check(checkNodeVersion(22).ok === true, "current Node satisfies the >=22 requirement")
    check(checkNodeVersion(999).ok === false, "an absurd requirement correctly fails")
})

test("env: loadEnv parses KEY=VALUE, skips comments/blanks, never overrides", () => {
    const dir = mkdtempSync(join(tmpdir(), "framer-sync-env-test-"))
    const path = join(dir, ".env")
    writeFileSync(path, "# comment\n\nFOO=bar\nQUOTED=\"has spaces\"\n")
    delete process.env.FOO
    delete process.env.QUOTED
    process.env.ALREADY_SET = "keep-me"
    writeFileSync(join(dir, ".env2"), "ALREADY_SET=overwritten\n")
    loadEnv(path)
    check(process.env.FOO === "bar", "plain KEY=VALUE parsed")
    check(process.env.QUOTED === "has spaces", "quoted value unwrapped")
    loadEnv(join(dir, ".env2"))
    check(process.env.ALREADY_SET === "keep-me", "existing env vars are never overridden")
    rmSync(dir, { recursive: true, force: true })
})

test("report: plan formatting includes the counts", () => {
    const plan = buildPlan([desiredRow("JSP-000001")], [], ["JSP-000001"])
    const text = formatPlanText(plan, { dryRun: true })
    check(text.includes("create:    1"), "text summary includes the create count")
    const md = planToMarkdown(plan, { dryRun: true })
    check(md.includes("| Create | 1 |"), "markdown summary includes the create count")
})

test("config: exactly 21 fields are defined", () => {
    check(FIELD_DEFINITIONS.length === 21, `expected 21 fields, found ${FIELD_DEFINITIONS.length}`)
})

// ---------------------------------------------------------------------------

async function run() {
    for (const t of tests) {
        currentTest = t.name
        try {
            await t.fn()
        } catch (err) {
            failures += 1
            console.error(`  FAIL [${t.name}] threw: ${err.stack ?? err}`)
        }
    }

    console.log(`\n${assertions} assertions, ${failures} failed, across ${tests.length} tests.`)
    process.exit(failures > 0 ? 1 : 0)
}

run()

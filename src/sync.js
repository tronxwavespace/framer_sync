#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { checkNodeVersion, PROJECT_ROOT } from "./env.js"
import { loadConfig, ConfigError, COLLECTION_NAME } from "./config.js"
import { parseCsv } from "./source.js"
import { validateRows, ValidationError } from "./validate.js"
import { buildPlan, isNoop } from "./plan.js"
import {
    createClient,
    findCollection,
    detectSchemaDrift,
    buildFieldMap,
    getExistingItems,
    applyPlan,
    publish,
    disconnect,
    SchemaDriftError,
} from "./framer.js"
import { printPlan, writeJobSummary, planToMarkdown } from "./report.js"

export const EXIT_OK = 0
export const EXIT_ENV_ERROR = 1
export const EXIT_VALIDATION_ERROR = 2
export const EXIT_SCHEMA_ERROR = 3
export const EXIT_FRAMER_ERROR = 4

export function loadSourceData(dataDir = join(PROJECT_ROOT, "data")) {
    const csvPath = join(dataDir, "problems.csv")
    const manifestPath = join(dataDir, "problems.manifest.json")
    if (!existsSync(csvPath) || !existsSync(manifestPath)) {
        throw new ConfigError(
            `No extracted data found in ${dataDir}. Run "npm run extract:starter" or "npm run extract" first.`,
        )
    }
    const csvRows = parseCsv(readFileSync(csvPath, "utf8"))
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
    return { csvRows, manifest }
}

export async function runSync({
    dryRun = false,
    publishAfter = true,
    dataDir,
    connectImpl,
} = {}) {
    const nodeCheck = checkNodeVersion()
    if (!nodeCheck.ok) {
        return { exitCode: EXIT_ENV_ERROR, message: nodeCheck.message }
    }

    const config = loadConfig()
    const { csvRows, manifest } = loadSourceData(dataDir)

    let rows
    try {
        rows = validateRows(csvRows)
    } catch (err) {
        if (err instanceof ValidationError) {
            return { exitCode: EXIT_VALIDATION_ERROR, message: err.message }
        }
        throw err
    }

    const framer = await createClient({
        apiKey: config.apiKey,
        projectUrl: config.projectUrl,
        connectImpl,
    })

    try {
        const collection = await findCollection(framer, config.collectionName)
        if (!collection) {
            return {
                exitCode: EXIT_SCHEMA_ERROR,
                message: `Collection "${COLLECTION_NAME}" does not exist yet. Run "npm run setup" first.`,
            }
        }

        const existingFields = await collection.getFields()
        const driftIssues = detectSchemaDrift(existingFields, config.fields)
        if (driftIssues.length > 0) {
            return {
                exitCode: EXIT_SCHEMA_ERROR,
                message: new SchemaDriftError(driftIssues).message,
            }
        }

        const fieldMap = buildFieldMap(existingFields, config.fields)
        const existingItems = await getExistingItems(collection, fieldMap)
        const scopeIds = manifest.scope?.ids ?? rows.map((r) => r.problemId)

        const plan = buildPlan(rows, existingItems, scopeIds)
        printPlan(plan, { dryRun })
        writeJobSummary(planToMarkdown(plan, { dryRun, published: dryRun ? undefined : publishAfter && !isNoop(plan) }))

        if (dryRun) {
            return { exitCode: EXIT_OK, plan }
        }

        const result = await applyPlan(collection, plan, fieldMap, { batchSize: config.batchSize })

        let published = false
        if (publishAfter && !isNoop(plan)) {
            await publish(framer)
            published = true
        }

        return { exitCode: EXIT_OK, plan, result, published }
    } catch (err) {
        if (err instanceof SchemaDriftError) {
            return { exitCode: EXIT_SCHEMA_ERROR, message: err.message }
        }
        return { exitCode: EXIT_FRAMER_ERROR, message: err.stack ?? String(err) }
    } finally {
        await disconnect(framer)
    }
}

async function main() {
    const args = process.argv.slice(2)
    const dryRun = args.includes("--dry-run")
    const publishAfter = !args.includes("--no-publish")

    try {
        const outcome = await runSync({ dryRun, publishAfter })
        if (outcome.message) {
            console.error(outcome.message)
        }
        if (outcome.exitCode === EXIT_OK && !outcome.message) {
            console.log(dryRun ? "\nDry run complete." : "\nSync complete.")
        }
        process.exit(outcome.exitCode)
    } catch (err) {
        console.error(err.stack ?? String(err))
        process.exit(EXIT_ENV_ERROR)
    }
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`
if (isMain) {
    main()
}

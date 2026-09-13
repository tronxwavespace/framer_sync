#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { checkNodeVersion, loadEnv, PROJECT_ROOT } from "../src/env.js"
import { loadConfig, SOURCE, COLLECTION_NAME } from "../src/config.js"
import { createClient, findCollection, detectSchemaDrift, disconnect } from "../src/framer.js"

function ok(label) {
    console.log(`  [ok]   ${label}`)
}
function warn(label) {
    console.log(`  [warn] ${label}`)
}
function fail(label) {
    console.log(`  [fail] ${label}`)
}

async function main() {
    console.log("framer-cms-sync -- setup diagnostics\n")
    let hasFailure = false

    const nodeCheck = checkNodeVersion()
    nodeCheck.ok ? ok(nodeCheck.message) : (fail(nodeCheck.message), (hasFailure = true))

    loadEnv()
    const hasApiKey = Boolean(process.env.FRAMER_API_KEY)
    const hasProjectUrl = Boolean(process.env.FRAMER_PROJECT_URL)
    hasApiKey ? ok("FRAMER_API_KEY is set") : (fail("FRAMER_API_KEY is not set (see .env.example)"), (hasFailure = true))
    hasProjectUrl
        ? ok("FRAMER_PROJECT_URL is set")
        : (fail("FRAMER_PROJECT_URL is not set (see .env.example)"), (hasFailure = true))

    try {
        const url = `https://raw.githubusercontent.com/${SOURCE.owner}/${SOURCE.repo}/${SOURCE.ref}/problems/${SOURCE.catalogFiles[0]}`
        const res = await fetch(url, { method: "HEAD" })
        res.ok
            ? ok(`GitHub source reachable (${SOURCE.owner}/${SOURCE.repo}@${SOURCE.ref})`)
            : (fail(`GitHub source returned ${res.status} for ${url}`), (hasFailure = true))
    } catch (err) {
        fail(`Could not reach GitHub source: ${err.message}`)
        hasFailure = true
    }

    const dataDir = join(PROJECT_ROOT, "data")
    const manifestPath = join(dataDir, "problems.manifest.json")
    if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
        ok(`Extracted data present: ${manifest.rowCount} rows (scope: ${manifest.scope.mode}, generated ${manifest.generatedAt})`)
    } else {
        warn(`No extracted data yet. Run "npm run extract:starter" or "npm run extract".`)
    }

    if (hasApiKey && hasProjectUrl) {
        let framer
        try {
            const config = loadConfig()
            framer = await createClient({ apiKey: config.apiKey, projectUrl: config.projectUrl })
            ok("Connected to Framer project")

            const collection = await findCollection(framer, COLLECTION_NAME)
            if (!collection) {
                warn(`Collection "${COLLECTION_NAME}" does not exist yet. Run "npm run setup".`)
            } else {
                ok(`Collection "${COLLECTION_NAME}" exists (${collection.id})`)
                const fields = await collection.getFields()
                const drift = detectSchemaDrift(fields, config.fields)
                if (drift.length === 0) {
                    ok(`All ${config.fields.length} expected fields present`)
                } else {
                    fail(`Schema drift detected:\n    ${drift.join("\n    ")}`)
                    hasFailure = true
                }
            }
        } catch (err) {
            fail(`Could not reach Framer: ${err.message}`)
            hasFailure = true
        } finally {
            if (framer) await disconnect(framer)
        }
    } else {
        warn("Skipping Framer connectivity check (credentials not set).")
    }

    console.log()
    console.log(hasFailure ? "Some checks failed -- see above." : "All checks passed.")
    process.exit(hasFailure ? 1 : 0)
}

main().catch((err) => {
    console.error(err.stack ?? String(err))
    process.exit(1)
})

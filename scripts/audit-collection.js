#!/usr/bin/env node
// One-off (repeatable) cleanup: find CMS items whose Problem ID doesn't
// correspond to any real problem in the source catalog -- e.g. a manually
// created test item -- and archive them. Never deletes (see CLAUDE.md:
// "Removal archives, it does not delete").
import { checkNodeVersion } from "../src/env.js"
import { loadConfig, COLLECTION_NAME } from "../src/config.js"
import { isValidProblemId } from "../src/validate.js"
import { createClient, findCollection, buildFieldMap, getExistingItems, applyPlan, disconnect } from "../src/framer.js"

async function main() {
    const nodeCheck = checkNodeVersion()
    if (!nodeCheck.ok) {
        console.error(nodeCheck.message)
        process.exit(1)
    }

    const apply = process.argv.includes("--apply")
    const config = loadConfig()
    const framer = await createClient({ apiKey: config.apiKey, projectUrl: config.projectUrl })

    try {
        const collection = await findCollection(framer, config.collectionName)
        if (!collection) {
            console.error(`Collection "${COLLECTION_NAME}" does not exist. Run "npm run setup" first.`)
            process.exit(1)
        }

        const fields = await collection.getFields()
        const fieldMap = buildFieldMap(fields, config.fields)
        const items = await getExistingItems(collection, fieldMap)

        const orphans = items.filter((item) => item.syncStatus !== "Archived" && !isValidProblemId(item.problemId))

        console.log(`Collection has ${items.length} item(s).`)
        console.log(`${orphans.length} item(s) don't correspond to a real problem id from the source catalog:`)
        for (const item of orphans) {
            console.log(`  - ${item.frameItemId} slug="${item.slug}" problemId="${item.problemId}"`)
        }

        if (orphans.length === 0) {
            console.log("Nothing to archive.")
            return
        }

        if (!apply) {
            console.log("\nDry run -- nothing changed. Re-run with --apply to archive these items.")
            return
        }

        const plan = {
            creates: [],
            updates: [],
            unchanged: [],
            archives: orphans.map((item) => ({ frameItemId: item.frameItemId, problemId: item.problemId })),
        }
        const result = await applyPlan(collection, plan, fieldMap, { batchSize: config.batchSize })
        console.log(`Archived ${result.archived} item(s).`)
    } finally {
        await disconnect(framer)
    }
}

main().catch((err) => {
    console.error(err.stack ?? String(err))
    process.exit(1)
})

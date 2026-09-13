#!/usr/bin/env node
import { checkNodeVersion } from "../src/env.js"
import { loadConfig } from "../src/config.js"
import { createClient, ensureCollection, ensureFields, disconnect } from "../src/framer.js"

async function main() {
    const nodeCheck = checkNodeVersion()
    if (!nodeCheck.ok) {
        console.error(nodeCheck.message)
        process.exit(1)
    }

    const config = loadConfig()
    const framer = await createClient({ apiKey: config.apiKey, projectUrl: config.projectUrl })

    try {
        const { collection, created } = await ensureCollection(framer, config.collectionName)
        console.log(
            created
                ? `Created collection "${config.collectionName}" (${collection.id})`
                : `Found existing collection "${config.collectionName}" (${collection.id})`,
        )

        const fieldMap = await ensureFields(collection, config.fields)
        const fieldCount = Object.keys(fieldMap).length
        console.log(`Collection now has ${fieldCount}/${config.fields.length} expected fields.`)

        if (fieldCount !== config.fields.length) {
            const missing = config.fields.filter((f) => !fieldMap[f.key])
            console.error(`Missing fields: ${missing.map((f) => f.name).join(", ")}`)
            process.exit(1)
        }

        console.log("Setup complete.")
    } finally {
        await disconnect(framer)
    }
}

main().catch((err) => {
    console.error(err.stack ?? String(err))
    process.exit(1)
})

// THE ONLY FILE THAT IMPORTS framer-api. The Server API is in open beta;
// isolating it here means an upstream change is a one-file fix.
import { connect as realConnect } from "framer-api"

export class SchemaDriftError extends Error {
    constructor(issues) {
        super(`Framer collection schema does not match the expected fields:\n` + issues.map((i) => `  - ${i}`).join("\n"))
        this.name = "SchemaDriftError"
        this.issues = issues
    }
}

export async function createClient({ apiKey, projectUrl, connectImpl = realConnect }) {
    return connectImpl(projectUrl, apiKey)
}

export async function findCollection(framer, name) {
    const collections = await framer.getCollections()
    return collections.find((c) => c.name === name) ?? null
}

export async function ensureCollection(framer, name) {
    const existing = await findCollection(framer, name)
    if (existing) return { collection: existing, created: false }
    const collection = await framer.createCollection(name)
    return { collection, created: true }
}

/**
 * Compare the collection's actual fields against the expected field
 * definitions. Returns a list of human-readable drift issues; empty means
 * the schema matches.
 */
export function detectSchemaDrift(existingFields, fieldDefs) {
    const issues = []
    const byName = new Map(existingFields.map((f) => [f.name, f]))

    for (const def of fieldDefs) {
        const found = byName.get(def.name)
        if (!found) {
            issues.push(`missing field "${def.name}" (${def.type})`)
            continue
        }
        if (found.type !== def.type) {
            issues.push(`field "${def.name}" is type "${found.type}", expected "${def.type}"`)
            continue
        }
        if (def.type === "enum") {
            const caseNames = new Set((found.cases ?? []).map((c) => c.name))
            for (const caseName of def.cases) {
                if (!caseNames.has(caseName)) {
                    issues.push(`field "${def.name}" is missing enum case "${caseName}"`)
                }
            }
        }
    }

    return issues
}

/**
 * Create any fields (and enum cases) from fieldDefs that don't already
 * exist on the collection. Used by scripts/setup-collection.js.
 */
export async function ensureFields(collection, fieldDefs) {
    const existing = await collection.getFields()
    const byName = new Map(existing.map((f) => [f.name, f]))

    const toCreate = fieldDefs.filter((def) => !byName.has(def.name))
    if (toCreate.length > 0) {
        const created = await collection.addFields(
            toCreate.map((def) => {
                if (def.type === "enum") {
                    return { type: "enum", name: def.name, cases: def.cases.map((name) => ({ name })) }
                }
                return { type: def.type, name: def.name }
            }),
        )
        created.forEach((field, i) => byName.set(toCreate[i].name, field))
    }

    for (const def of fieldDefs) {
        if (def.type !== "enum") continue
        const field = byName.get(def.name)
        const existingCaseNames = new Set((field.cases ?? []).map((c) => c.name))
        for (const caseName of def.cases) {
            if (!existingCaseNames.has(caseName)) {
                await field.addCase({ name: caseName })
            }
        }
    }

    return buildFieldMap(await collection.getFields(), fieldDefs)
}

/**
 * Build a lookup from our internal field key to { id, type, caseIds } based
 * on the collection's actual fields (matched by name).
 */
export function buildFieldMap(existingFields, fieldDefs) {
    const byName = new Map(existingFields.map((f) => [f.name, f]))
    const map = {}
    for (const def of fieldDefs) {
        const field = byName.get(def.name)
        if (!field) continue
        const entry = { id: field.id, type: def.type }
        if (def.type === "enum") {
            entry.caseIdByName = new Map((field.cases ?? []).map((c) => [c.name, c.id]))
            entry.caseNameById = new Map((field.cases ?? []).map((c) => [c.id, c.name]))
        }
        map[def.key] = entry
    }
    return map
}

function fieldEntryFor(fieldMap, key, value) {
    const field = fieldMap[key]
    if (!field) throw new SchemaDriftError([`no Framer field mapped for "${key}"`])

    if (field.type === "enum") {
        const caseId = field.caseIdByName.get(value)
        if (!caseId) {
            throw new SchemaDriftError([`field for "${key}" has no case named "${value}"`])
        }
        return { type: "enum", value: caseId }
    }
    if (field.type === "number") {
        return { type: "number", value: Number(value) }
    }
    if (field.type === "link") {
        return { type: "link", value: value || null }
    }
    return { type: "string", value: value ?? "" }
}

export function buildFieldData(row, fieldMap) {
    const fieldData = {}
    for (const key of Object.keys(fieldMap)) {
        if (!(key in row)) continue
        fieldData[fieldMap[key].id] = fieldEntryFor(fieldMap, key, row[key])
    }
    return fieldData
}

export async function getExistingItems(collection, fieldMap) {
    const items = await collection.getItems()
    return items.map((item) => {
        const problemIdField = fieldMap.problemId
        const syncHashField = fieldMap.syncHash
        const syncStatusField = fieldMap.syncStatus

        const problemId = problemIdField ? item.fieldData[problemIdField.id]?.value ?? "" : ""
        const syncHash = syncHashField ? item.fieldData[syncHashField.id]?.value ?? "" : ""
        const syncStatusCaseId = syncStatusField ? item.fieldData[syncStatusField.id]?.value : undefined
        const syncStatus = syncStatusCaseId ? syncStatusField.caseNameById.get(syncStatusCaseId) ?? "Active" : "Active"

        return { frameItemId: item.id, problemId, slug: item.slug, syncHash, syncStatus }
    })
}

function chunk(array, size) {
    const chunks = []
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size))
    }
    return chunks
}

/**
 * Write a plan (see src/plan.js) to the collection in batches. Returns
 * counts of what was written. Archiving clears Sync Hash so a problem that
 * reappears upstream is not skipped as "unchanged".
 */
export async function applyPlan(collection, plan, fieldMap, { batchSize = 50 } = {}) {
    const archivedCaseId = fieldMap.syncStatus?.caseIdByName.get("Archived")

    const createItems = plan.creates.map((row) => ({
        slug: row.slug,
        fieldData: buildFieldData({ ...row, syncStatus: "Active", syncHash: row.contentHash }, fieldMap),
    }))

    const updateItems = plan.updates.map(({ row, frameItemId }) => ({
        id: frameItemId,
        fieldData: buildFieldData({ ...row, syncStatus: "Active", syncHash: row.contentHash }, fieldMap),
    }))

    const archiveItems = plan.archives.map(({ frameItemId }) => ({
        id: frameItemId,
        fieldData: {
            [fieldMap.syncStatus.id]: { type: "enum", value: archivedCaseId },
            [fieldMap.syncHash.id]: { type: "string", value: "" },
        },
    }))

    for (const batch of chunk([...createItems, ...updateItems, ...archiveItems], batchSize)) {
        await collection.addItems(batch)
    }

    return {
        created: createItems.length,
        updated: updateItems.length,
        archived: archiveItems.length,
    }
}

export async function publish(framer) {
    return framer.publish()
}

export async function disconnect(framer) {
    if (typeof framer.disconnect === "function") {
        await framer.disconnect()
    }
}

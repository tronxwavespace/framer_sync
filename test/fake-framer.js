// In-memory stand-in for framer-api's connect() result. Mirrors the real
// API's semantics closely enough for src/framer.js to be exercised without
// a network connection or an API key -- notably that addItems updates when
// an id matches an existing item and creates when it does not.

function randomSuffix() {
    return Math.random().toString(36).slice(2, 8)
}

class FakeField {
    constructor(id, name, type, cases) {
        this.id = id
        this.name = name
        this.type = type
        if (type === "enum") this.cases = cases ?? []
    }

    async addCase({ name }) {
        const c = { id: `${this.id}_case_${this.cases.length + 1}_${randomSuffix()}`, name }
        this.cases.push(c)
        return c
    }
}

class FakeCollection {
    constructor(id, name) {
        this.id = id
        this.name = name
        this._fields = []
        this._items = []
        this._nextItemId = 1
    }

    async getFields() {
        return this._fields
    }

    async addFields(defs) {
        const created = defs.map((def) => {
            const id = `field_${this._fields.length + 1}_${randomSuffix()}`
            const cases = def.type === "enum" ? def.cases.map((c) => ({ id: `${id}_case_${randomSuffix()}`, name: c.name })) : undefined
            const field = new FakeField(id, def.name, def.type, cases)
            this._fields.push(field)
            return field
        })
        return created
    }

    async removeFields(fieldIds) {
        this._fields = this._fields.filter((f) => !fieldIds.includes(f.id))
    }

    async getItems() {
        return this._items.map((it) => ({ id: it.id, slug: it.slug, fieldData: { ...it.fieldData } }))
    }

    async addItems(items) {
        for (const input of items) {
            if (input.id) {
                const existing = this._items.find((it) => it.id === input.id)
                if (!existing) throw new Error(`addItems: no item with id ${input.id}`)
                if (input.slug !== undefined) existing.slug = input.slug
                if (input.fieldData) existing.fieldData = { ...existing.fieldData, ...input.fieldData }
            } else {
                const id = `item_${this._nextItemId++}`
                this._items.push({ id, slug: input.slug, fieldData: { ...(input.fieldData ?? {}) } })
            }
        }
    }

    async removeItems(ids) {
        this._items = this._items.filter((it) => !ids.includes(it.id))
    }
}

class FakeFramer {
    constructor() {
        this._collections = []
        this.publishCount = 0
        this.disconnected = false
    }

    async getCollections() {
        return this._collections
    }

    async createCollection(name) {
        const collection = new FakeCollection(`col_${this._collections.length + 1}_${randomSuffix()}`, name)
        this._collections.push(collection)
        return collection
    }

    async publish() {
        this.publishCount += 1
        return { success: true }
    }

    async disconnect() {
        this.disconnected = true
    }
}

export function createFakeConnect() {
    const framer = new FakeFramer()
    const connectImpl = async () => framer
    return { framer, connectImpl }
}

import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")

function parseEnvFile(text) {
    const result = {}
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim()
        if (!line || line.startsWith("#")) continue
        const eq = line.indexOf("=")
        if (eq === -1) continue
        const key = line.slice(0, eq).trim()
        let value = line.slice(eq + 1).trim()
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1)
        }
        result[key] = value
    }
    return result
}

export function loadEnv(path = join(ROOT, ".env")) {
    if (!existsSync(path)) return {}
    const parsed = parseEnvFile(readFileSync(path, "utf8"))
    for (const [key, value] of Object.entries(parsed)) {
        if (process.env[key] === undefined) process.env[key] = value
    }
    return parsed
}

export function checkNodeVersion(required = 22) {
    const major = Number(process.versions.node.split(".")[0])
    if (Number.isNaN(major) || major < required) {
        return {
            ok: false,
            message: `framer-api requires Node ${required}+. Running Node ${process.versions.node}.`,
        }
    }
    return { ok: true, message: `Node ${process.versions.node}` }
}

export const PROJECT_ROOT = ROOT

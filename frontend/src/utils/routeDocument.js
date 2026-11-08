/**
 * Which database a `#/doc/<id>` address opens (docs/specs/active/editor-toc-and-internal-links.md
 * §6.8, "The deep-link route"). An address may come without a database key (a PDF link,
 * a new tab, a hand-typed address) or with one that is no use here. The id is then
 * looked up across the databases open on this device, waiting for start-up to finish
 * first, so a space Document is not reported missing only because it had not arrived.
 * A missing Document and one in a database this device cannot open look the same.
 */
import { parseDatabaseKey } from '@/utils/databaseKey'

/** Longest wait for start-up (space discovery and the first sync) before deciding. */
export const STARTUP_WAIT_MS = 30000

/**
 * A `dbKey` query that can be used as it is: canonical and open on this device.
 *
 * @param {unknown} value
 * @param {Map<string, { db?: unknown }>} databases `syncStore.databases`
 * @returns {string|null}
 */
export function usableDbKey(value, databases) {
    if (typeof value !== 'string') return null
    try {
        parseDatabaseKey(value)
    } catch {
        return null
    }
    return databases?.get(value)?.db ? value : null
}

/**
 * Find the database of a Document, waiting for start-up when it is not found at once.
 *
 * @param {string} id
 * @param {object} deps
 * @param {(id: string) => Promise<string|null>} deps.lookup `docStore.findDocumentDbKey`
 * @param {() => Promise<void>} deps.waitForStartup resolves once spaces are open and the
 *   first sync has finished, or failed offline
 * @returns {Promise<string|null>}
 */
export async function locateDocument(id, { lookup, waitForStartup }) {
    const found = await lookup(id)
    if (found) return found
    try {
        await waitForStartup()
    } catch {
        // Offline or refused: decide with what this device holds.
    }
    return lookup(id)
}

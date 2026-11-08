// /frontend/src/store/documentLinkStore.js
/**
 * Where links to other Documents point (docs/specs/active/editor-toc-and-internal-links.md
 * §6.2): resolution of `panino:doc/<id>` against the databases open on this device, the
 * headings of a Document for the link picker, the lookup of a deep link without a
 * database key, and the picker's search. Only the Document id is ever stored in a link;
 * which database holds it is found here, on the reader's device, and a Document that is
 * gone looks exactly like one in a database the reader cannot open.
 *
 * Exposed through the docStore facade (`resolveDocuments`, `getDocumentOutline`,
 * `findDocumentDbKey`).
 */
import { ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { isDocumentId } from '@panino/content-merge/document-links';
import { documentOutline } from '@panino/content-merge/table-of-contents';
import { useSyncStore } from './syncStore';
import { useStructureStore } from './structureStore';
import { useDraftStore } from './draftStore';
import { useGlobalVariablesStore } from './globalVariablesStore';

/** Ids per `IN (…)` query. */
const CHUNK = 500;
/** Rows a picker search returns. */
const PICKER_LIMIT = 20;

/** A LIKE pattern matching the text literally anywhere, with `\` as the escape. */
function containsPattern(text) {
  return `%${String(text).replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

const FOLDER_PATHS = `
    WITH RECURSIVE folder_paths AS (
        SELECT id, parent_id, name AS path FROM folders WHERE parent_id IS NULL
        UNION ALL
        SELECT child.id, child.parent_id, folder_paths.path || ' / ' || child.name
        FROM folders AS child JOIN folder_paths ON folder_paths.id = child.parent_id
    )`;

/**
 * @typedef {object} ResolvedDocument
 * @property {string} id
 * @property {string} dbKey
 * @property {string} title
 * @property {string} folderPath '' at the database root
 * @property {string|null} spaceName null for the personal database
 */

export const useDocumentLinkStore = defineStore('documentLinkStore', () => {
  const syncStore = useSyncStore();
  const structureStore = useStructureStore();
  const draftStore = useDraftStore();

  /** id → ResolvedDocument, or null when no open database has it. */
  const cache = new Map();
  /** Bumped whenever resolution may have changed, so decorations re-run. */
  const version = ref(0);

  function invalidate() {
    cache.clear();
    version.value += 1;
  }

  // The structure changed (rename, move, delete, a save), a database opened or closed,
  // or a sync pulled rows (refreshData reloads the tree).
  watch(() => structureStore.contentVersion, invalidate);
  watch(() => structureStore.rootItems, invalidate);
  watch(
    () => [...syncStore.databases.values()].map((entry) => `${entry.dbKey}:${entry.db ? 1 : 0}`).join('|'),
    invalidate,
  );

  /** Open databases, the given one first, then personal, then spaces. */
  function orderedDatabases(firstDbKey = null) {
    const entries = [...syncStore.databases.values()].filter((entry) => entry.db);
    const rank = (entry) => (entry.dbKey === firstDbKey ? 0 : entry.kind === 'space' ? 2 : 1);
    return entries.sort((a, b) => rank(a) - rank(b));
  }

  /**
   * Resolve Document ids across the open databases.
   *
   * @param {string[]} ids
   * @param {{ preferDbKey?: string|null }} [options] the database to try first (the
   *   linking Document's own)
   * @returns {Promise<Map<string, ResolvedDocument|null>>}
   */
  async function resolveDocuments(ids, { preferDbKey = null } = {}) {
    const wanted = [...new Set((ids || []).filter(isDocumentId).map((id) => id.toLowerCase()))];
    const result = new Map();
    const missing = [];
    for (const id of wanted) {
      if (cache.has(id)) result.set(id, cache.get(id));
      else missing.push(id);
    }
    if (missing.length) {
      const found = new Map();
      for (const entry of orderedDatabases(preferDbKey)) {
        const pending = missing.filter((id) => !found.has(id));
        if (!pending.length) break;
        for (let start = 0; start < pending.length; start += CHUNK) {
          const chunk = pending.slice(start, start + CHUNK);
          try {
            const rows = await syncStore.repository(entry.dbKey).execute(`
              ${FOLDER_PATHS}
              SELECT notes.id, notes.title, COALESCE(folder_paths.path, '') AS folderPath
              FROM notes LEFT JOIN folder_paths ON folder_paths.id = notes.folder_id
              WHERE notes.id IN (${chunk.map(() => '?').join(', ')})
            `, chunk);
            for (const row of rows) {
              const id = String(row.id).toLowerCase();
              if (found.has(id)) continue;
              found.set(id, {
                id: row.id,
                dbKey: entry.dbKey,
                title: row.title || 'Untitled',
                folderPath: row.folderPath || '',
                spaceName: entry.kind === 'space' ? (entry.name || 'Shared space') : null,
              });
            }
          } catch (error) {
            console.error(`[documentLinkStore] Resolving links failed for ${entry.dbKey}:`, error);
          }
        }
      }
      for (const id of missing) {
        const value = found.get(id) || null;
        cache.set(id, value);
        result.set(id, value);
      }
    }
    return result;
  }

  /**
   * The database that holds a Document, personal first, then spaces. Asks each open
   * database directly (no cache), for a deep link that came without a database key.
   *
   * @param {string} id
   * @returns {Promise<string|null>}
   */
  async function findDocumentDbKey(id) {
    if (typeof id !== 'string' || !id || id.length > 64) return null;
    for (const entry of orderedDatabases(null)) {
      try {
        const rows = await syncStore.repository(entry.dbKey).execute('SELECT id FROM notes WHERE id = ?', [id]);
        if (rows.length) return entry.dbKey;
      } catch (error) {
        console.error(`[documentLinkStore] Looking up a Document failed for ${entry.dbKey}:`, error);
      }
    }
    return null;
  }

  /**
   * The headings of a Document, for the picker. The open Document's unsaved text counts.
   *
   * @param {string} id
   * @param {string} dbKey
   * @returns {Promise<import('@panino/content-merge/document-outline').OutlineHeading[]>}
   */
  async function getDocumentOutline(id, dbKey) {
    if (!id || !dbKey) return [];
    let text = draftStore.getDraft(id);
    if (text === undefined) {
      try {
        const rows = await syncStore.repository(dbKey).execute('SELECT content FROM notes WHERE id = ?', [id]);
        text = rows[0]?.content ?? '';
      } catch (error) {
        console.error('[documentLinkStore] Reading headings failed:', error);
        return [];
      }
    }
    return documentOutline(text, { globals: useGlobalVariablesStore().globalsMap });
  }

  /**
   * Documents whose title matches, for the link picker: the given database first, then
   * the most recently updated, at most 20. An empty query lists the most recent.
   *
   * @param {string} query
   * @param {{ preferDbKey?: string|null, limit?: number }} [options]
   * @returns {Promise<Array<ResolvedDocument & { updatedAt: string|null }>>}
   */
  async function searchLinkTargets(query, { preferDbKey = null, limit = PICKER_LIMIT } = {}) {
    const term = String(query ?? '').trim().slice(0, 200);
    const cap = Math.max(1, Math.min(Number(limit) || PICKER_LIMIT, PICKER_LIMIT));
    const rows = [];
    for (const entry of orderedDatabases(preferDbKey)) {
      try {
        const found = await syncStore.repository(entry.dbKey).execute(`
          ${FOLDER_PATHS}
          SELECT notes.id, notes.title, notes.updated_at, COALESCE(folder_paths.path, '') AS folderPath
          FROM notes LEFT JOIN folder_paths ON folder_paths.id = notes.folder_id
          ${term ? "WHERE notes.title LIKE ? ESCAPE '\\'" : ''}
          ORDER BY datetime(notes.updated_at) DESC
          LIMIT ?
        `, term ? [containsPattern(term), cap] : [cap]);
        for (const row of found) {
          rows.push({
            id: row.id,
            dbKey: entry.dbKey,
            title: row.title || 'Untitled',
            folderPath: row.folderPath || '',
            spaceName: entry.kind === 'space' ? (entry.name || 'Shared space') : null,
            updatedAt: row.updated_at || null,
            preferred: entry.dbKey === preferDbKey,
          });
        }
      } catch (error) {
        console.error(`[documentLinkStore] Link search failed for ${entry.dbKey}:`, error);
      }
    }
    rows.sort((a, b) => (Number(b.preferred) - Number(a.preferred))
      || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return rows.slice(0, cap).map(({ preferred: _preferred, ...row }) => row);
  }

  /**
   * Ask the Preview showing the open Document to scroll to one of its headings (a
   * same-Document link followed from the editor). `{ slug, nonce }`.
   */
  const headingRequest = ref(null);
  let headingNonce = 0;
  function requestHeading(slug) {
    headingNonce += 1;
    headingRequest.value = { slug: slug || null, nonce: headingNonce };
  }

  return {
    version,
    invalidate,
    headingRequest,
    requestHeading,
    resolveDocuments,
    findDocumentDbKey,
    getDocumentOutline,
    searchLinkTargets,
  };
});

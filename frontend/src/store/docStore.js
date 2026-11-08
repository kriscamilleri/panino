// /frontend/src/store/docStore.js
import { ref, computed } from "vue";
import { defineStore } from "pinia";
import { storeToRefs } from "pinia";
import { useStructureStore } from "./structureStore";
import { useMarkdownStore } from "./markdownStore";
import { useSyncStore } from "./syncStore";
import { useDraftStore } from "./draftStore";
import { useImportExportStore } from "./importExportStore";
import { useConflictStore } from "./conflictStore";
import { useStylePresetStore } from "./stylePresetStore";
import { useDocumentLinkStore } from "./documentLinkStore";
import { normalizeRecentDocument } from "../utils/recentDocuments.js";
import { hasDocumentContentChanged } from "../utils/documentPersistence.js";
import { mergeDashboardRows } from "../utils/syncRegistry.js";
import { DEFAULT_SEARCH_LIMIT, PERSONAL_LABELS, searchDatabases } from "@panino/content-merge/document-search";
import { useDocumentIndexStore } from "./documentIndexStore";
import { normalizeSort, sortDocuments } from "../utils/homeView.js";

export const useDocStore = defineStore("docStore", () => {
  const structureStore = useStructureStore();
  const markdownStore = useMarkdownStore();
  const syncStore = useSyncStore();
  const draftStore = useDraftStore();
  const importExportStore = useImportExportStore();
  const conflictStore = useConflictStore();
  const stylePresetStore = useStylePresetStore();
  const isSaving = ref(false);
  const recentDocVersion = ref(0);

  // Pull refs out of the other stores WITHOUT wrapping them in computed again
  const {
    selectedFileId,
    selectedFolderId,
    selectedDbKey,
    openFolders,
    rootItems,
    selectedFile,
    selectedFileContent,
    contentVersion,
  } = storeToRefs(structureStore);

  const { styles, printStyles } = storeToRefs(markdownStore);

  /**
   * True when the open document has local edits that differ from its base and
   * have not yet been persisted. Consumed by the editor's save-status surface.
   * See COLLAB-01.
   */
  const isDirty = computed(() => {
    const id = selectedFileId.value;
    if (!id) return false;
    const draft = draftStore.getDraft(id);
    if (draft === undefined) return false;
    const base = draftStore.getBase(id) ?? selectedFile.value?.content ?? "";
    return hasDocumentContentChanged(base, draft);
  });

  async function loadInitialData() {
    // This is now mainly for selecting a default file after the initial sync
    await structureStore.loadRootItems(); // Ensure root items are loaded
    if (structureStore.rootItems.length > 0 && !structureStore.selectedFileId) {
      const firstFile = structureStore.rootItems.find(
        (item) => item.type === "file" && item.dbKey === syncStore.personalDbKey,
      );
      if (firstFile) {
        structureStore.selectFile(firstFile.id, firstFile.dbKey);
      }
    }
  }
  async function refreshData() {
    console.info("[DocStore] Refreshing data after sync.");
    await structureStore.loadRootItems();
    if (structureStore.selectedFileId) {
      // This is the key change: explicitly re-fetch the current file's data
      await structureStore.reFetchSelectedFile();
    }
    await conflictStore.loadConflicts();
    await stylePresetStore.reloadLoaded();
    recentDocVersion.value++;
  }

  async function resetStore() {
    await syncStore.resetDatabase();
    structureStore.resetStore();
    markdownStore.resetStyles();
    markdownStore.resetPrintStyles();
    stylePresetStore.reset();
    console.info("All stores have been reset.");
  }

  /**
   * Recursive folder-path CTE shared by both dashboard queries, so a document's
   * displayed path is built the same way whichever scope loaded it.
   */
  const FOLDER_PATHS_CTE = `
            WITH RECURSIVE folder_paths AS (
                SELECT
                    id,
                    parent_id,
                    name,
                    name AS path
                FROM folders
                WHERE parent_id IS NULL

                UNION ALL

                SELECT
                    child.id,
                    child.parent_id,
                    child.name,
                    folder_paths.path || ' / ' || child.name AS path
                FROM folders AS child
                JOIN folder_paths ON folder_paths.id = child.parent_id
            )`;

  const DOCUMENT_COLUMNS = `
                notes.id,
                notes.title,
                notes.content,
                notes.updated_at,
                notes.created_at,
                notes.folder_id,
                notes.pinned,
                COALESCE(folder_paths.path, 'Root') AS folderPath`;

  /**
   * `ORDER BY` for a phone sort. Built only from these constants, never from
   * the caller's text. Ties fall back to the title, then the id.
   */
  const SORT_SQL = {
    modified: "datetime(notes.updated_at)",
    created: "datetime(notes.created_at)",
    title: "notes.title COLLATE NOCASE",
  };

  function orderByFor(sort) {
    if (!sort) return "datetime(notes.updated_at) DESC";
    const { field, direction } = normalizeSort(sort);
    const dir = direction === "asc" ? "ASC" : "DESC";
    return `${SORT_SQL[field]} ${dir}, notes.title COLLATE NOCASE ASC, notes.id ASC`;
  }

  /**
   * Merge per-database rows. Without a sort this is the dashboards' newest-first
   * merge; with one, every database's rows are ordered the same way and the
   * newest-first limit must not cut the wrong ones.
   */
  function mergeSorted(groups, limit, sort) {
    if (!sort) return mergeDashboardRows(groups, { limit }).map(normalizeRecentDocument);
    const all = mergeDashboardRows(groups, { limit: Number.MAX_SAFE_INTEGER }).map(normalizeRecentDocument);
    return sortDocuments(all, sort).slice(0, limit);
  }

  /**
   * Most recently modified documents across every folder — the global Recent
   * Documents scope.
   *
   * @param {number} [limit] bounded result size; the dashboard filters in memory
   * @param {{ sort?: { field: string, direction: string } }} [options] a phone
   *   sort; without one, newest modified first
   * @returns {Promise<object[]>} normalized documents
   */
  async function getRecentDocuments(limit = 50, { sort } = {}) {
    const query = `
            ${FOLDER_PATHS_CTE}

            SELECT
${DOCUMENT_COLUMNS}
            FROM notes
            LEFT JOIN folder_paths ON folder_paths.id = notes.folder_id
            ORDER BY ${orderByFor(sort)}
            LIMIT ?
        `;
    try {
      const groups = [];
      for (const entry of syncStore.databases.values()) {
        if (!entry.db) continue;
        try {
          groups.push({
            dbKey: entry.dbKey,
            name: entry.kind === 'space' ? entry.name : null,
            // The newest `limit` overall are among the newest `limit` of each
            // database, so each query is bounded; unbounded, it read every
            // Document body in the library on each dashboard refresh.
            rows: await syncStore.repository(entry.dbKey).execute(query, [limit]),
          });
        } catch (error) {
          console.error(`Failed to query recent Documents for ${entry.dbKey}:`, error);
        }
      }
      return mergeSorted(groups, limit, sort);
    } catch (error) {
      console.error("Failed to get recent documents:", error);
      return [];
    }
  }

  /**
   * Documents assigned directly to one folder. Deliberately `folder_id = ?`
   * rather than a descendant walk: a folder dashboard shows that folder's own
   * documents, and a pinned document in a child folder appears only once that
   * child is opened.
   *
   * @param {string|null} folderId selected folder; `null` means the root scope
   * @param {number} [limit] bounded result size
   * @param {{ sort?: { field: string, direction: string } }} [options] a phone
   *   sort; without one, newest modified first
   * @returns {Promise<object[]>} normalized documents
   */
  async function getFolderDocuments(folderId, dbKey, limit = 50, { sort } = {}) {
    if (!dbKey) throw new Error('Database scope is required for a folder dashboard.');
    const query = `
            ${FOLDER_PATHS_CTE}

            SELECT
${DOCUMENT_COLUMNS}
            FROM notes
            LEFT JOIN folder_paths ON folder_paths.id = notes.folder_id
            WHERE notes.folder_id IS ?
            ORDER BY ${orderByFor(sort)}
            LIMIT ?
        `;
    try {
      const entry = syncStore.databases.get(dbKey);
      const results = await syncStore.repository(dbKey).execute(query, [folderId ?? null, limit]);
      return mergeSorted([
        { dbKey, name: entry?.kind === 'space' ? entry.name : null, rows: results },
      ], limit, sort);
    } catch (error) {
      console.error("Failed to get folder documents:", error);
      return [];
    }
  }

  // A newer search makes the older one stop before its next database query.
  let searchRun = 0;

  /**
   * Search every open database, personal and spaces, with the query language
   * of docs/specs/active/advanced-search.md §4 (words, "phrases", title:, in:,
   * is:checklist, prop: and -), in the API's order. The engine is
   * `@panino/content-merge/document-search`, which the API's parity test runs
   * against the server's search.
   *
   * @param {object} input
   * @param {string} input.query
   * @param {number} [input.limit] results per page (default 20, at most 100)
   * @param {object|null} [input.cursor] `nextCursor` of the previous page
   * @returns {Promise<{ results: object[], nextCursor: object|null, notices: string[],
   *   terms: string[], cancelled: boolean }>} normalized Documents with `inTrash`
   *   and `titleScore`; `cancelled` when a newer search started meanwhile
   */
  async function searchDocuments({ query, limit = DEFAULT_SEARCH_LIMIT, cursor = null } = {}) {
    const run = ++searchRun;
    const documentIndexStore = useDocumentIndexStore();
    const databases = [];
    for (const entry of syncStore.databases.values()) {
      if (!entry.db) continue;
      const repository = syncStore.repository(entry.dbKey);
      const isSpace = entry.kind === 'space';
      const dbKey = entry.dbKey;
      databases.push({
        dbKey,
        name: isSpace ? entry.name : null,
        labels: isSpace ? [entry.name] : [...PERSONAL_LABELS],
        execute: (sql, params) => repository.execute(sql, params),
        // tag: and front matter prop: parts read the metadata index (built on first use)
        // instead of the bodies; if it cannot be built, the engine reads the bodies' heads.
        index: async () => {
          try {
            await documentIndexStore.ensure(dbKey);
          } catch (error) {
            console.warn(`Search could not use the metadata index of ${dbKey}:`, error?.name || error);
            return null;
          }
          // A build that was abandoned (the handle was reopened or dropped meanwhile) resolves
          // too, with no index: then it must not answer, or every tag: would find nothing.
          if (!documentIndexStore.isReady(dbKey)) return null;
          return {
            entries: () => documentIndexStore.metadataEntries(dbKey),
            idsWithTags: (names) => documentIndexStore.idsWithTags(dbKey, names),
          };
        },
      });
    }
    const found = await searchDatabases({
      databases, query, limit, cursor, isCancelled: () => run !== searchRun,
    });
    for (const failure of found.failed || []) {
      console.error(`Search failed for ${failure.dbKey}:`, failure.error);
    }
    return {
      results: found.results.map((row) => ({
        ...normalizeRecentDocument({ ...row, folderPath: row.folderPath || null }),
        inTrash: row.inTrash,
        titleScore: row.title_score,
      })),
      nextCursor: found.nextCursor,
      notices: found.notices,
      terms: found.terms,
      cancelled: Boolean(found.cancelled),
    };
  }

  /**
   * Every folder in one database with its full path, sorted by path.
   *
   * @param {string} dbKey
   * @returns {Promise<{id: string, name: string, parentId: string|null, path: string, dbKey: string}[]>}
   */
  async function listFolders(dbKey) {
    if (!dbKey) throw new Error('Database scope is required to list folders.');
    const rows = await syncStore.repository(dbKey).execute(`
            ${FOLDER_PATHS_CTE}
            SELECT id, name, parent_id, path FROM folder_paths
            ORDER BY path COLLATE NOCASE
        `);
    return rows.map((row) => ({
      id: row.id,
      name: row.name || 'Untitled folder',
      parentId: row.parent_id ?? null,
      path: row.path || row.name || 'Untitled folder',
      dbKey,
    }));
  }

  /**
   * Pin or unpin a document. `updated_at` moves with the change so the document
   * orders consistently in the dashboards and replicates as an ordinary document edit.
   *
   * @param {string} noteId
   * @param {boolean} pinned
   * @returns {Promise<void>} rejects so the caller can revert its optimistic state
   */
  async function setDocumentPinned(noteId, pinned, dbKey) {
    if (!noteId) throw new Error("A document id is required to change pin state.");
    if (!dbKey) throw new Error('Database scope is required to change pin state.');

    await syncStore.repository(dbKey).transaction((repo) => repo.exec(
      "UPDATE notes SET pinned = ?, updated_at = ? WHERE id = ?",
      [pinned ? 1 : 0, new Date().toISOString(), noteId],
    ));

    if (selectedFile.value?.id === noteId) {
      selectedFile.value.pinned = pinned ? 1 : 0;
    }
    structureStore.markContentChanged();
  }

  async function updateFileContent(fileId, newContent, dbKey) {
    if (!dbKey) throw new Error('Database scope is required to update a Document.');
    isSaving.value = true; // <--- Set to true
    try {
      const now = new Date().toISOString();
      // The merge base in `note_sync_base` is the body the server holds. It is
      // captured here, before the first edit that makes the document differ,
      // and never overwritten by a later save: a base that already contains an
      // unsent edit makes every incoming body look safe to adopt and the edit
      // is lost without a conflict. syncStore drops it once the upload is
      // acknowledged, so only documents with edits in flight have one.
      await syncStore.repository(dbKey).transaction(async (repo) => {
        await syncStore.captureMergeBase(dbKey, repo, fileId);
        // A stored conflict for this Document follows the text being written,
        // so resolving it later compares against this save, not the one before.
        await syncStore.followLocalBodyWrite(dbKey, repo, fileId, newContent);
        await repo.exec(
          "UPDATE notes SET content = ?, updated_at = ? WHERE id = ?",
          [newContent, now, fileId],
        );
      });
      // The editor's in-memory base is different: it is the text the editor
      // last wrote, used to tell a clean editor from a dirty one (COLLAB-01).
      draftStore.setBase(fileId, newContent);
      if (selectedFile.value?.id === fileId) {
        selectedFile.value.content = newContent; // Optimistic update
      }
      structureStore.markContentChanged();
    } finally {
      // Add a small delay so the user can actually see the "Saving" state flicker
      setTimeout(() => {
        isSaving.value = false;
      }, 300);
    }
  }

  return {
    // State & Getters (forwarded refs)
    selectedFileId,
    selectedFolderId,
    selectedDbKey,
    openFolders,
    styles,
    printStyles,
    rootItems,
    selectedFile,
    selectedFileContent,
    contentVersion,

    // Expose stores if you still need direct access
    structureStore,
    syncStore,
    markdownStore,

    // Actions from structureStore
    loadInitialData,
    resetStore,
    loadRootItems: structureStore.loadRootItems,
    getChildren: structureStore.getChildren,
    getFolderTrail: structureStore.getFolderTrail,
    createFile: structureStore.createFile,
    createFolder: structureStore.createFolder,
    deleteItem: structureStore.deleteItem,
    renameItem: structureStore.renameItem,
    moveItem: structureStore.moveItem,
    selectFile: structureStore.selectFile,
    selectFolder: structureStore.selectFolder,
    toggleFolder: structureStore.toggleFolder,
    isFolderOpen: structureStore.isFolderOpen,
    duplicateFile: structureStore.duplicateFile,
    updateFileContent: updateFileContent, // structureStore.updateFileContent,

    // Actions from other stores
    exportJson: importExportStore.exportDataAsJsonString,
    exportZip: importExportStore.exportDataAsZip,
    importData: importExportStore.importData,
    exportStackEditJson: importExportStore.exportDataAsStackEditJsonString,
    importStackEditData: importExportStore.importStackEditData,
    importMarkdownFiles: importExportStore.importMarkdownFiles,
    importMarkdownDirectory: importExportStore.importMarkdownDirectory,
    listMarkdownDocumentsInDirectory: importExportStore.listMarkdownDocumentsInDirectory,
    importDocumentWithLinkedImages: importExportStore.importDocumentWithLinkedImages,
    importZipArchive: importExportStore.importZipArchive,

    updateStyle: markdownStore.updateStyle,
    getMarkdownIt: markdownStore.getMarkdownIt,
    updatePrintStyle: markdownStore.updatePrintStyle,
    getPrintMarkdownIt: markdownStore.getPrintMarkdownIt,
    getRecentDocuments,
    getFolderDocuments,
    searchDocuments,
    listFolders,
    setDocumentPinned,
    // Links to other Documents (documentLinkStore.js), created on first use.
    resolveDocuments: (...args) => useDocumentLinkStore().resolveDocuments(...args),
    getDocumentOutline: (...args) => useDocumentLinkStore().getDocumentOutline(...args),
    findDocumentDbKey: (...args) => useDocumentLinkStore().findDocumentDbKey(...args),
    refreshData, // Expose the new function
    recentDocVersion,
    isSaving,
    isDirty,
  };
});

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
import { normalizeRecentDocument } from "../utils/recentDocuments.js";
import { hasDocumentContentChanged } from "../utils/documentPersistence.js";
import { mergeDashboardRows } from "../utils/syncRegistry.js";
import { likePattern, hasChecklist } from "../utils/searchQuery.js";
import { normalizeSort, sortDocuments } from "../utils/homeView.js";

export const useDocStore = defineStore("docStore", () => {
  const structureStore = useStructureStore();
  const markdownStore = useMarkdownStore();
  const syncStore = useSyncStore();
  const draftStore = useDraftStore();
  const importExportStore = useImportExportStore();
  const conflictStore = useConflictStore();
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
    recentDocVersion.value++;
  }

  async function resetStore() {
    await syncStore.resetDatabase();
    structureStore.resetStore();
    markdownStore.resetStyles();
    markdownStore.resetPrintStyles();
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

  /**
   * Search Documents by title, or title and body, across every open database
   * or within one folder and its subfolders. Terms are matched literally.
   *
   * @param {object} input
   * @param {string} input.query
   * @param {'everything'|'titles'|'checklists'|'folder'} [input.scope]
   * @param {string|null} [input.folderId] with scope 'folder'; null or the dbKey means the database root
   * @param {string} [input.dbKey] with scope 'folder'
   * @param {number} [input.limit] per database
   * @returns {Promise<object[]>} normalized Documents, newest first
   */
  async function searchDocuments({ query, scope = 'everything', folderId = null, dbKey = null, limit = 50 } = {}) {
    const term = String(query ?? '').trim();
    if (!term) return [];
    const pattern = likePattern(term);
    const titlesOnly = scope === 'titles';
    const inFolder = scope === 'folder' && dbKey;
    const scopedFolder = inFolder && folderId && folderId !== dbKey ? folderId : null;
    const sql = `
            ${FOLDER_PATHS_CTE}${scopedFolder ? `,
            scope_folders(id) AS (
                SELECT ?
                UNION ALL
                SELECT folders.id FROM folders JOIN scope_folders ON folders.parent_id = scope_folders.id
            )` : ''}
            SELECT
${DOCUMENT_COLUMNS}
            FROM notes
            LEFT JOIN folder_paths ON folder_paths.id = notes.folder_id
            WHERE (notes.title LIKE ? ESCAPE '\\'${titlesOnly ? '' : " OR notes.content LIKE ? ESCAPE '\\'"})
            ${scope === 'checklists' ? "AND notes.content LIKE '%[%]%'" : ''}
            ${scopedFolder ? 'AND notes.folder_id IN (SELECT id FROM scope_folders)' : ''}
            ORDER BY datetime(notes.updated_at) DESC
            LIMIT ?
        `;
    const params = [
      ...(scopedFolder ? [scopedFolder] : []),
      pattern,
      ...(titlesOnly ? [] : [pattern]),
      limit,
    ];
    const entries = inFolder
      ? [syncStore.databases.get(dbKey)].filter(Boolean)
      : [...syncStore.databases.values()];
    const groups = [];
    for (const entry of entries) {
      if (!entry.db) continue;
      try {
        groups.push({
          dbKey: entry.dbKey,
          name: entry.kind === 'space' ? entry.name : null,
          rows: await syncStore.repository(entry.dbKey).execute(sql, params),
        });
      } catch (error) {
        console.error(`Search failed for ${entry.dbKey}:`, error);
      }
    }
    const results = mergeDashboardRows(groups, { limit: limit * Math.max(1, groups.length) })
      .map(normalizeRecentDocument);
    return scope === 'checklists' ? results.filter((doc) => hasChecklist(doc.content)) : results;
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
    refreshData, // Expose the new function
    recentDocVersion,
    isSaving,
    isDirty,
  };
});

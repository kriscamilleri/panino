// /frontend/src/store/stylePresetStore.js
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { useSyncStore } from './syncStore'
import { useStructureStore } from './structureStore'
import { useMarkdownStore } from './markdownStore'
import { useUiStore } from './uiStore'
import {
  STYLE_FRONT_MATTER_KEYS,
  assignmentId,
  isStyleKind,
  normalizeStyleName,
  parseStyleValues,
  readDocumentStyleNames,
  resolveStylePreset,
  serializeStyleValues,
  styleNameError,
} from '@/utils/stylePresets'

/** A name the user must change; its message is safe to show. */
class StyleNameError extends Error {
  constructor(message) {
    super(message)
    this.name = 'StyleNameError'
  }
}

/**
 * Named preview and print styles, per library, and the folder and template
 * defaults that point at them. See docs/specs/shipped/named-styles.md.
 */
export const useStylePresetStore = defineStore('stylePresetStore', () => {
  const syncStore = useSyncStore()
  const structureStore = useStructureStore()
  const markdownStore = useMarkdownStore()
  const uiStore = useUiStore()

  /** dbKey → { presets: Array, assignments: Map<assignment id, style id|null> } */
  const libraries = ref(new Map())
  /** Folder ids of the selected Document, its own folder first. */
  const selectedFolderTrail = ref([])

  function toPreset(row) {
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      values: parseStyleValues(row.styles, row.kind),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  /**
   * Read a library's named styles and defaults from its database.
   * @param {string} dbKey
   */
  async function loadLibrary(dbKey) {
    if (!dbKey) throw new Error('Database scope is required to load styles.')
    const repo = syncStore.repository(dbKey)
    const [presetRows, assignmentRows] = await Promise.all([
      repo.execute('SELECT id, kind, name, styles, created_at, updated_at FROM style_presets ORDER BY name COLLATE NOCASE'),
      repo.execute('SELECT id, preset_id FROM style_assignments'),
    ])
    libraries.value.set(dbKey, {
      presets: (presetRows || []).filter((r) => isStyleKind(r.kind)).map(toPreset),
      assignments: new Map((assignmentRows || []).map((r) => [r.id, r.preset_id || null])),
    })
  }

  /** Reload every library already read, after a sync brought new rows. */
  async function reloadLoaded() {
    const keys = [...libraries.value.keys()].filter((dbKey) => syncStore.databases.has(dbKey))
    for (const dbKey of libraries.value.keys()) {
      if (!keys.includes(dbKey)) libraries.value.delete(dbKey)
    }
    await Promise.all(keys.map((dbKey) => loadLibrary(dbKey).catch((err) => {
      console.warn('[stylePresetStore] Failed to reload styles', err)
    })))
    await refreshSelectedTrail()
  }

  /**
   * @param {string} dbKey
   * @param {'preview'|'print'} [kind] all kinds when omitted
   */
  function presetsFor(dbKey, kind) {
    const presets = libraries.value.get(dbKey)?.presets || []
    return kind ? presets.filter((p) => p.kind === kind) : presets
  }

  function findPreset(dbKey, id) {
    return presetsFor(dbKey).find((p) => p.id === id) || null
  }

  /**
   * The style a folder or template names as its default, if it still exists.
   * @returns {string|null} style id
   */
  function assignmentFor(dbKey, targetType, targetId, kind) {
    const presetId = libraries.value.get(dbKey)?.assignments.get(assignmentId(targetType, targetId, kind)) || null
    return presetId && findPreset(dbKey, presetId) ? presetId : null
  }

  /**
   * Save a new named style.
   * @param {string} dbKey
   * @param {'preview'|'print'} kind
   * @param {string} name
   * @param {object} values the styles to start from
   * @returns {Promise<object>} the new style
   */
  async function createPreset(dbKey, kind, name, values) {
    if (!isStyleKind(kind)) throw new Error(`Unknown style kind: ${kind}`)
    const error = styleNameError(name, presetsFor(dbKey, kind))
    if (error) throw new StyleNameError(error)
    const id = uuidv4()
    const now = new Date().toISOString()
    const styles = serializeStyleValues(values, kind)
    try {
      await syncStore.repository(dbKey).transaction((repo) => repo.exec(
        'INSERT INTO style_presets (id, kind, name, styles, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, kind, normalizeStyleName(name), styles, now, now],
      ))
    } catch (err) {
      uiStore.addToast('Failed to save the style.', 'error')
      throw err
    }
    await loadLibrary(dbKey)
    return findPreset(dbKey, id)
  }

  /**
   * Replace a named style's values. The in-memory copy changes at once so the
   * preview follows typing; the write follows.
   */
  async function updatePresetValues(dbKey, id, values) {
    const preset = findPreset(dbKey, id)
    if (!preset) throw new Error('That style no longer exists.')
    const styles = serializeStyleValues(values, preset.kind)
    preset.values = parseStyleValues(styles, preset.kind)
    try {
      await syncStore.repository(dbKey).transaction((repo) => repo.exec(
        'UPDATE style_presets SET styles = ?, updated_at = ? WHERE id = ?',
        [styles, new Date().toISOString(), id],
      ))
    } catch (err) {
      uiStore.addToast('Failed to save the style.', 'error')
      throw err
    }
  }

  async function renamePreset(dbKey, id, name) {
    const preset = findPreset(dbKey, id)
    if (!preset) throw new Error('That style no longer exists.')
    const error = styleNameError(name, presetsFor(dbKey, preset.kind), id)
    if (error) throw new StyleNameError(error)
    try {
      await syncStore.repository(dbKey).transaction((repo) => repo.exec(
        'UPDATE style_presets SET name = ?, updated_at = ? WHERE id = ?',
        [normalizeStyleName(name), new Date().toISOString(), id],
      ))
    } catch (err) {
      uiStore.addToast('Failed to rename the style.', 'error')
      throw err
    }
    await loadLibrary(dbKey)
  }

  /** Delete a named style and clear every default that pointed at it. */
  async function deletePreset(dbKey, id) {
    const now = new Date().toISOString()
    try {
      await syncStore.repository(dbKey).transaction(async (repo) => {
        await repo.exec(
          'UPDATE style_assignments SET preset_id = NULL, updated_at = ? WHERE preset_id = ?',
          [now, id],
        )
        await repo.exec('DELETE FROM style_presets WHERE id = ?', [id])
      })
    } catch (err) {
      uiStore.addToast('Failed to delete the style.', 'error')
      throw err
    }
    await loadLibrary(dbKey)
  }

  /**
   * Set or clear (`presetId` null) the default style of a folder or template.
   */
  async function setAssignment(dbKey, targetType, targetId, kind, presetId) {
    const id = assignmentId(targetType, targetId, kind)
    if (presetId && !findPreset(dbKey, presetId)) throw new Error('That style no longer exists.')
    await syncStore.repository(dbKey).transaction((repo) => repo.exec(
      `INSERT INTO style_assignments (id, target_type, target_id, kind, preset_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET preset_id = excluded.preset_id, updated_at = excluded.updated_at`,
      [id, targetType, targetId, kind, presetId || null, new Date().toISOString()],
    ))
    const library = libraries.value.get(dbKey)
    if (library) library.assignments.set(id, presetId || null)
    else await loadLibrary(dbKey)
  }

  /**
   * The front matter a Document created from a template should start with.
   * @returns {Object<string,string>} e.g. `{ 'print-style': 'Invoice' }`
   */
  function templateFrontMatter(dbKey, templateId) {
    const entries = {}
    for (const kind of ['preview', 'print']) {
      const presetId = assignmentFor(dbKey, 'template', templateId, kind)
      if (presetId) entries[STYLE_FRONT_MATTER_KEYS[kind]] = findPreset(dbKey, presetId).name
    }
    return entries
  }

  /**
   * Which style a Document uses for one kind, and its values.
   * @param {'preview'|'print'} kind
   * @param {{ dbKey: string|null, content?: string, folderTrail?: string[] }} doc
   * @returns {{ preset: object|null, source: string, values: object }}
   */
  function resolve(kind, { dbKey, content = '', folderTrail = [] }) {
    const names = readDocumentStyleNames(content)
    const { preset, source, folderId } = resolveStylePreset({
      kind,
      documentStyleName: names[kind],
      folderTrail,
      presets: dbKey ? presetsFor(dbKey) : [],
      assignments: (dbKey && libraries.value.get(dbKey)?.assignments) || new Map(),
    })
    const values = preset
      ? preset.values
      : (kind === 'print' ? markdownStore.printStyles : markdownStore.styles)
    return { preset, source, folderId, values }
  }

  /**
   * `resolve` for the selected Document. Pass the text being shown, which may
   * be an unsaved draft, so a front matter change applies while typing.
   */
  function resolveForSelected(kind, content) {
    return resolve(kind, {
      dbKey: structureStore.selectedDbKey,
      content: content ?? structureStore.selectedFile?.content ?? '',
      folderTrail: selectedFolderTrail.value,
    })
  }

  async function refreshSelectedTrail() {
    const dbKey = structureStore.selectedDbKey
    const folderId = structureStore.selectedFile?.folder_id || null
    if (!dbKey || !syncStore.databases.has(dbKey)) {
      selectedFolderTrail.value = []
      return
    }
    try {
      if (!libraries.value.has(dbKey)) await loadLibrary(dbKey)
      const trail = folderId ? await structureStore.getFolderTrail(folderId, dbKey) : []
      selectedFolderTrail.value = trail.map((f) => f.id).reverse()
    } catch (err) {
      console.warn('[stylePresetStore] Failed to read the folder trail', err)
      selectedFolderTrail.value = []
    }
  }

  // The trail changes when another Document is selected, the Document moves,
  // or the tree is reloaded after a move or a sync.
  watch(
    () => [
      syncStore.isInitialized,
      structureStore.selectedDbKey,
      structureStore.selectedFile?.id,
      structureStore.selectedFile?.folder_id,
      structureStore.rootItems,
    ],
    ([ready]) => { if (ready) refreshSelectedTrail() },
    { immediate: true },
  )

  function reset() {
    libraries.value = new Map()
    selectedFolderTrail.value = []
  }

  return {
    libraries,
    selectedFolderTrail,
    loadLibrary,
    reloadLoaded,
    presetsFor,
    findPreset,
    assignmentFor,
    createPreset,
    updatePresetValues,
    renamePreset,
    deletePreset,
    setAssignment,
    templateFrontMatter,
    resolve,
    resolveForSelected,
    refreshSelectedTrail,
    reset,
  }
})

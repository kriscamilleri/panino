// Links between Documents through ZIP and JSON export and import
// (docs/specs/active/editor-toc-and-internal-links.md §6.7).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import JSZip from 'jszip'

const OLD_PLAN = '6f1c2a3b-1d2e-4f5a-8b6c-7d8e9f0a1b2c'
const OLD_NOTES = '11111111-2222-4333-8444-555555555555'
const OUTSIDE = '99999999-9999-4999-8999-999999999999'

const hoisted = vi.hoisted(() => ({ saved: null, authStore: null, syncStore: null, docStore: null }))

vi.mock('../../src/store/authStore.js', () => ({ useAuthStore: () => hoisted.authStore }))
vi.mock('../../src/store/syncStore.js', () => ({ useSyncStore: () => hoisted.syncStore }))
vi.mock('../../src/store/docStore.js', () => ({ useDocStore: () => hoisted.docStore }))
vi.mock('file-saver', () => ({ saveAs: vi.fn((blob) => { hoisted.saved = blob }) }))

const { useImportExportStore } = await import('../../src/store/importExportStore.js')

function createDb(seed = {}) {
    const tables = { folders: [...(seed.folders || [])], notes: [...(seed.notes || [])] }
    const execute = vi.fn(async (sql, params = []) => {
        if (sql.includes('FROM folders WHERE parent_id IS ? AND name = ?')) {
            return tables.folders.filter((folder) => folder.parent_id === (params[0] ?? null) && folder.name === params[1])
        }
        if (sql.includes('FROM notes WHERE folder_id IS ? AND title = ?')) {
            return tables.notes.filter((note) => note.folder_id === (params[0] ?? null) && note.title === params[1])
        }
        if (sql === 'SELECT * FROM folders') return tables.folders
        if (sql === 'SELECT * FROM notes') return tables.notes
        return []
    })
    const exec = vi.fn(async (sql, params = []) => {
        if (sql.startsWith('INSERT INTO folders')) {
            tables.folders.push({ id: params[0], name: params[2], parent_id: params[3] })
        } else if (sql.startsWith('INSERT INTO notes')) {
            tables.notes.push({ id: params[0], folder_id: params[2], title: params[3], content: params[4] })
        } else if (sql.startsWith('UPDATE notes SET content')) {
            const note = tables.notes.find((row) => row.id === params[2])
            if (note) note.content = params[0]
        }
    })
    return { tables, repository: { execute, exec } }
}

function useDb(db) {
    hoisted.syncStore = {
        isInitialized: true,
        isOnline: true,
        syncEnabled: true,
        personalDbKey: 'user:me',
        sync: vi.fn(async () => {}),
        captureMergeBase: vi.fn(async () => {}),
        followLocalBodyWrite: vi.fn(async () => {}),
        personalRepository: () => db.repository,
    }
}

beforeEach(() => {
    setActivePinia(createPinia())
    hoisted.authStore = { user: { id: 'user-1' }, isAuthenticated: false, token: null }
    hoisted.docStore = { loadInitialData: vi.fn(async () => {}) }
    hoisted.saved = null
})

describe('ZIP export', () => {
    it('writes links to exported Documents as relative .md paths and lists the ids', async () => {
        const db = createDb({
            folders: [{ id: 'f1', name: 'Proposals', parent_id: null }, { id: 'f2', name: 'Notes', parent_id: null }],
            notes: [
                { id: OLD_PLAN, folder_id: 'f1', title: 'Project plan', content: '## Budget\n' },
                { id: OLD_NOTES, folder_id: 'f2', title: 'Plan notes', content: `See [the plan](panino:doc/${OLD_PLAN}#budget), [outside](panino:doc/${OUTSIDE}) and [web](https://x.y).` },
            ],
        })
        useDb(db)
        await useImportExportStore().exportDataAsZip()
        const zip = await JSZip.loadAsync(await hoisted.saved.arrayBuffer())
        const notes = await zip.file('Notes/Plan notes.md').async('string')
        expect(notes).toBe(`See [the plan](../Proposals/Project%20plan.md#budget), [outside](panino:doc/${OUTSIDE}) and [web](https://x.y).`)
        const metadata = JSON.parse(await zip.file('_panino_metadata.json').async('string'))
        expect(metadata.notes).toEqual([
            { id: OLD_PLAN, path: 'Proposals/Project plan.md' },
            { id: OLD_NOTES, path: 'Notes/Plan notes.md' },
        ])
    })
})

describe('importing links', () => {
    it('turns relative .md links between imported files into panino:doc links to the new ids', async () => {
        const db = createDb()
        useDb(db)
        const zip = new JSZip()
        zip.file('Proposals/Project plan.md', '## Budget\n')
        zip.file('Notes/Plan notes.md', 'See [the plan](../Proposals/Project%20plan.md#budget) and [missing](Gone.md).')
        await useImportExportStore().importZipArchive(await zip.generateAsync({ type: 'uint8array' }))
        const plan = db.tables.notes.find((note) => note.title === 'Project plan')
        const notes = db.tables.notes.find((note) => note.title === 'Plan notes')
        expect(notes.content).toBe(`See [the plan](panino:doc/${plan.id}#budget) and [missing](Gone.md).`)
        expect(plan.id).not.toBe(OLD_PLAN)
    })

    it('remaps panino:doc links to old ids listed in the ZIP metadata', async () => {
        const db = createDb()
        useDb(db)
        const zip = new JSZip()
        zip.file('Proposals/Project plan.md', '## Budget\n')
        zip.file('Notes/Plan notes.md', `Old [link](panino:doc/${OLD_PLAN}) and [outside](panino:doc/${OUTSIDE}).`)
        zip.file('_panino_metadata.json', JSON.stringify({ version: 2, notes: [{ id: OLD_PLAN, path: 'Proposals/Project plan.md' }, { id: OLD_NOTES, path: 'Notes/Plan notes.md' }] }))
        await useImportExportStore().importZipArchive(await zip.generateAsync({ type: 'uint8array' }))
        const plan = db.tables.notes.find((note) => note.title === 'Project plan')
        const notes = db.tables.notes.find((note) => note.title === 'Plan notes')
        expect(notes.content).toBe(`Old [link](panino:doc/${plan.id}) and [outside](panino:doc/${OUTSIDE}).`)
    })

    it('remaps links between Documents of the same JSON file', async () => {
        const db = createDb()
        useDb(db)
        await useImportExportStore().importData({
            folders: [],
            notes: [
                { id: OLD_PLAN, title: 'Project plan', content: '## Budget\n', folder_id: null },
                { id: OLD_NOTES, title: 'Plan notes', content: `[Plan](panino:doc/${OLD_PLAN}#budget) [Other](panino:doc/${OUTSIDE})`, folder_id: null },
            ],
        })
        const plan = db.tables.notes.find((note) => note.title === 'Project plan')
        const notes = db.tables.notes.find((note) => note.title === 'Plan notes')
        expect(notes.content).toBe(`[Plan](panino:doc/${plan.id}#budget) [Other](panino:doc/${OUTSIDE})`)
    })

    it('links to the existing Document an import overwrites', async () => {
        const db = createDb({ notes: [{ id: OLD_PLAN, folder_id: null, title: 'Project plan', content: 'old' }] })
        useDb(db)
        const zip = new JSZip()
        zip.file('Project plan.md', 'new')
        zip.file('Plan notes.md', '[Plan](Project%20plan.md)')
        await useImportExportStore().importZipArchive(await zip.generateAsync({ type: 'uint8array' }), null, { allowUnsafeOverwrite: true })
        expect(db.tables.notes.find((note) => note.title === 'Plan notes').content).toBe(`[Plan](panino:doc/${OLD_PLAN})`)
    })
})

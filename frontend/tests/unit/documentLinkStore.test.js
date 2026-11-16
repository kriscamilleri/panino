import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import { nextTick, ref } from 'vue'
import { toSnippetLines } from '@/utils/markdownSnippet'

const PERSONAL = 'user:11111111-1111-4111-8111-111111111111'
const SPACE = 'space:22222222-2222-4222-8222-222222222222'
const A = 'aaaaaaaa-1111-4111-8111-111111111111'
const B = 'bbbbbbbb-2222-4222-8222-222222222222'

const rows = {
    [PERSONAL]: [{ id: A, title: 'Plan', folderPath: 'Work', updated_at: '2026-01-01T00:00:00Z', content: '## Budget\n' }],
    [SPACE]: [{ id: B, title: 'Brief', folderPath: '', updated_at: '2026-02-01T00:00:00Z', content: '' }],
}
const calls = []
const repository = (dbKey) => ({
    execute: vi.fn(async (sql, params) => {
        calls.push({ dbKey, sql, params })
        if (sql.includes('WHERE notes.id IN')) return rows[dbKey].filter((row) => params.includes(row.id))
        if (sql.includes('SELECT id FROM notes WHERE id = ?')) return rows[dbKey].filter((row) => row.id === params[0])
        if (sql.includes('SELECT content FROM notes')) return rows[dbKey].filter((row) => row.id === params[0])
        if (sql.includes('notes.title LIKE')) return rows[dbKey].filter((row) => row.title.toLowerCase().includes(params[0].slice(1, -1).toLowerCase()))
        return rows[dbKey]
    }),
})

vi.mock('@/store/syncStore', async () => {
    const { ref: makeRef } = await import('vue')
    const databases = makeRef(new Map([
        ['user:11111111-1111-4111-8111-111111111111', { dbKey: 'user:11111111-1111-4111-8111-111111111111', kind: 'user', db: {} }],
        ['space:22222222-2222-4222-8222-222222222222', { dbKey: 'space:22222222-2222-4222-8222-222222222222', kind: 'space', name: 'Acme', db: {} }],
    ]))
    return { useSyncStore: () => ({ databases: databases.value, databasesRef: databases, repository: (key) => repository(key) }) }
})
const contentVersion = ref(0)
vi.mock('@/store/structureStore', () => ({
    useStructureStore: defineStore('structure', () => ({ contentVersion, rootItems: ref([]) })),
}))
vi.mock('@/store/draftStore', () => ({ useDraftStore: () => ({ getDraft: () => undefined }) }))
vi.mock('@/store/globalVariablesStore', () => ({ useGlobalVariablesStore: () => ({ globalsMap: new Map() }) }))

const { useDocumentLinkStore } = await import('@/store/documentLinkStore')

beforeEach(() => {
    setActivePinia(createPinia())
    calls.length = 0
})

describe('resolving Document links on this device', () => {
    it('finds ids across databases with one parameterized IN query each, and caches', async () => {
        const store = useDocumentLinkStore()
        const result = await store.resolveDocuments([A, B.toUpperCase(), 'not-an-id'])
        expect(result.get(A)).toMatchObject({ dbKey: PERSONAL, title: 'Plan', folderPath: 'Work', spaceName: null })
        expect(result.get(B)).toMatchObject({ dbKey: SPACE, title: 'Brief', spaceName: 'Acme' })
        expect(result.has('not-an-id')).toBe(false)
        const inQueries = calls.filter((call) => call.sql.includes('IN ('))
        expect(inQueries[0].params).toEqual([A, B])
        expect(inQueries.every((call) => !call.sql.includes(A))).toBe(true)
        calls.length = 0
        await store.resolveDocuments([A])
        expect(calls).toHaveLength(0)
    })

    it('reports an unknown id as null, the same for deleted and not shared', async () => {
        const store = useDocumentLinkStore()
        const missing = 'cccccccc-3333-4333-8333-333333333333'
        expect((await store.resolveDocuments([missing])).get(missing)).toBeNull()
    })

    it('forgets what it resolved when the structure changes', async () => {
        const store = useDocumentLinkStore()
        await store.resolveDocuments([A])
        const before = store.version
        contentVersion.value += 1
        await nextTick()
        expect(store.version).toBe(before + 1)
        calls.length = 0
        await store.resolveDocuments([A])
        expect(calls.length).toBeGreaterThan(0)
    })

    it('chunks long id lists at 500', async () => {
        const store = useDocumentLinkStore()
        const ids = Array.from({ length: 1200 }, (_, i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`)
        await store.resolveDocuments(ids)
        const sizes = calls.filter((call) => call.dbKey === PERSONAL && call.sql.includes('IN (')).map((call) => call.params.length)
        expect(sizes).toEqual([500, 500, 200])
    })

    it('looks up the database of a deep link, personal first', async () => {
        const store = useDocumentLinkStore()
        expect(await store.findDocumentDbKey(B)).toBe(SPACE)
        expect(await store.findDocumentDbKey('dddddddd-4444-4444-8444-444444444444')).toBeNull()
    })

    it('searches titles with the linking Document\'s database first', async () => {
        const store = useDocumentLinkStore()
        const all = await store.searchLinkTargets('', { preferDbKey: PERSONAL })
        expect(all.map((doc) => doc.id)).toEqual([A, B])
        const spaceFirst = await store.searchLinkTargets('', { preferDbKey: SPACE })
        expect(spaceFirst.map((doc) => doc.id)).toEqual([B, A])
        const like = calls.find((call) => call.sql.includes('LIKE'))
        expect(like).toBeUndefined()
        await store.searchLinkTargets('50%_off')
        expect(calls.find((call) => call.sql.includes('LIKE')).params[0]).toBe('%50\\%\\_off%')
    })

    it('reads the headings of another Document', async () => {
        const store = useDocumentLinkStore()
        expect((await store.getDocumentOutline(A, PERSONAL)).map((h) => h.slug)).toEqual(['budget'])
    })
})

describe('card snippets', () => {
    it('leave out the table of contents', () => {
        const markdown = '# Plan\n\n<!-- panino:toc {"v":1,"min":2,"max":3} -->\n**Contents**\n\n- 1 [Intro](#intro)\n<!-- /panino:toc -->\n\nReal text here.\n\n## Intro\n'
        expect(toSnippetLines(markdown, { title: 'Plan' }).map((line) => line.text)).toEqual(['Real text here.', 'Intro'])
    })
})

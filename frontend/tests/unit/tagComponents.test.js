// @vitest-environment jsdom
// Tag UI (tag-system.md §5): sidebar chips (first three, +N, colour from the Document's
// own database, click filters), the filter bar, the Tags manager, editor autocomplete,
// and the Trash and path helpers behind the filter.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { markRaw, nextTick, reactive } from 'vue';
import { folderPaths, trashFolderId, trashFolderIds } from '@/utils/tagFilter';

const PERSONAL = 'user:11111111-1111-4111-8111-111111111111';
const SPACE = 'space:22222222-2222-4222-8222-222222222222';

const harness = vi.hoisted(() => ({ syncStore: null, transformText: null }));
vi.mock('@/store/syncStore', () => ({ useSyncStore: () => harness.syncStore }));
vi.mock('@/store/editorStore', () => ({ useEditorStore: () => ({ transformText: (...args) => harness.transformText(...args) }) }));
vi.mock('@/store/docStore', () => ({ useDocStore: () => ({ selectedFileId: null, selectedDbKey: null, rootItems: [], recentDocVersion: 0, selectFile: vi.fn() }) }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const DocumentTagChips = (await import('@/components/tags/DocumentTagChips.vue')).default;
const TagFilterBar = (await import('@/components/tags/TagFilterBar.vue')).default;
const TagManagerModal = (await import('@/components/tags/TagManagerModal.vue')).default;
const TagAutocomplete = (await import('@/components/tags/TagAutocomplete.vue')).default;
const { useTagStore } = await import('@/store/tagStore');

function fakeDatabase({ notes = [], tags = [] }) {
    const state = { tags: new Map(tags.map((row) => [row.name, { display_name: '', created_at: '', updated_at: '', ...row }])), writes: [] };
    return markRaw({
        state,
        onUpdate: () => () => {},
        async execO(sql, params = []) {
            if (sql.includes('WHERE rowid > ?')) {
                return params[0] < 0 ? notes.map((note, i) => ({ rid: i + 1, id: note.id, head: note.content })) : [];
            }
            if (sql.includes('FROM tags')) return [...state.tags.values()];
            return [];
        },
        async exec(sql, params) {
            state.writes.push({ sql, params });
            if (sql.includes('INSERT INTO tags (name, color')) {
                state.tags.set(params[0], { ...(state.tags.get(params[0]) || { name: params[0], display_name: '' }), color: params[1] });
            }
        },
    });
}

function setup(databases) {
    harness.syncStore = reactive({
        personalDbKey: PERSONAL,
        databases: new Map(databases.map(([dbKey, db, name]) => [dbKey, { dbKey, kind: dbKey.split(':')[0], name, db }])),
        repository: (dbKey) => {
            const db = harness.syncStore.databases.get(dbKey).db;
            return {
                execute: (sql, params) => db.execO(sql, params),
                transaction: async (work) => work({ exec: (sql, params) => db.exec(sql, params) }),
            };
        },
        onRemoteChangesApplied: () => {},
    });
}

const mounted = [];
function track(wrapper) {
    mounted.push(wrapper);
    return wrapper;
}

beforeEach(() => {
    setActivePinia(createPinia());
});

afterEach(() => {
    while (mounted.length) mounted.pop().unmount();
    document.body.innerHTML = '';
});

async function settle() {
    for (let i = 0; i < 5; i += 1) {
        await flushPromises();
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}

const tagged = (...tags) => `---\ntags:\n${tags.map((tag) => `  - ${tag}`).join('\n')}\n---\nBody`;

describe('DocumentTagChips', () => {
    it('shows the first three tags and +N, coloured from the Document\'s own database', async () => {
        setup([
            [PERSONAL, fakeDatabase({ notes: [{ id: 'p', content: tagged('Work') }], tags: [{ name: 'work', color: 'coral' }] })],
            [SPACE, fakeDatabase({ notes: [{ id: 's', content: tagged('Work', 'b', 'c', 'd', 'e') }], tags: [{ name: 'work', color: 'seafoam', display_name: 'WORK' }] }), 'Team'],
        ]);
        const personal = track(mount(DocumentTagChips, { props: { dbKey: PERSONAL, noteId: 'p' } }));
        const space = track(mount(DocumentTagChips, { props: { dbKey: SPACE, noteId: 's' } }));
        await settle();

        const personalChip = personal.find('[data-tag="work"]');
        expect(personalChip.text()).toBe('#Work');
        expect(personalChip.attributes('data-tag-color')).toBe('coral');
        const spaceChips = space.findAll('[data-tag]');
        expect(spaceChips.map((chip) => chip.text())).toEqual(['#WORK', '#b', '#c']);
        expect(spaceChips[0].attributes('data-tag-color')).toBe('seafoam');
        expect(space.find(`[data-testid="document-tags-more-s"]`).text()).toBe('+2');
    });

    it('renders a hostile name as text and filters by the tag when clicked', async () => {
        setup([[PERSONAL, fakeDatabase({ notes: [{ id: 'p', content: tagged('"<img src=x onerror=alert(1)>"') }] })]]);
        const wrapper = track(mount(DocumentTagChips, { props: { dbKey: PERSONAL, noteId: 'p' } }));
        await settle();
        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>');
        await wrapper.find('button').trigger('click');
        expect(useTagStore().filters).toEqual(['<img src=x onerror=alert(1)>']);
    });

    it('shows nothing for a Document without tags', async () => {
        setup([[PERSONAL, fakeDatabase({ notes: [{ id: 'p', content: 'plain' }] })]]);
        const wrapper = track(mount(DocumentTagChips, { props: { dbKey: PERSONAL, noteId: 'p' } }));
        await settle();
        expect(wrapper.find('[data-tag]').exists()).toBe(false);
    });
});

describe('TagFilterBar', () => {
    it('lists the filters, removes one and clears all', async () => {
        setup([[PERSONAL, fakeDatabase({})]]);
        const store = useTagStore();
        const wrapper = track(mount(TagFilterBar));
        expect(wrapper.find('[data-testid="tag-filter-bar"]').exists()).toBe(false);
        store.addFilter('Work');
        store.addFilter('urgent');
        await nextTick();
        expect(wrapper.findAll('[data-tag]').map((chip) => chip.attributes('data-tag'))).toEqual(['work', 'urgent']);
        await wrapper.find('[data-testid="tag-filter-work"]').trigger('click');
        expect(store.filters).toEqual(['urgent']);
        await wrapper.find('[data-testid="tag-filter-clear"]').trigger('click');
        expect(store.filters).toEqual([]);
    });
});

describe('TagManagerModal', () => {
    it('lists a space\'s tags, warns that changes are shared, and writes a colour', async () => {
        const spaceDb = fakeDatabase({ notes: [{ id: 's', content: tagged('Work', 'urgent') }, { id: 't', content: tagged('work') }] });
        setup([[PERSONAL, fakeDatabase({})], [SPACE, spaceDb, 'Team']]);
        const store = useTagStore();
        const wrapper = track(mount(TagManagerModal, { attachTo: document.body, global: { stubs: { Teleport: true } } }));
        store.openManager(SPACE);
        await settle();

        expect(document.body.querySelector('[data-testid="tag-manager-space-note"]').textContent).toContain('Changes apply to everyone in Team.');
        const rows = [...document.body.querySelectorAll('[data-testid^="tag-manager-row-"]')];
        expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual(['tag-manager-row-urgent', 'tag-manager-row-work']);
        expect(rows[1].textContent).toContain('2 Documents');

        document.body.querySelector('[data-testid="tag-manager-color-work-mint"]').click();
        await settle();
        expect(spaceDb.state.writes[0].params.slice(0, 2)).toEqual(['work', 'mint']);
        expect(store.tagLook(SPACE, 'work').colorKey).toBe('mint');
        void wrapper;
    });
});

describe('TagAutocomplete', () => {
    it('offers tags under `tags:` and accepts with Enter before the editor sees the key', async () => {
        setup([[PERSONAL, fakeDatabase({ notes: [{ id: 'a', content: tagged('Work') }, { id: 'b', content: tagged('wonder') }] })]]);
        const host = document.createElement('div');
        const textarea = document.createElement('textarea');
        host.appendChild(textarea);
        document.body.appendChild(host);
        const editorKeydown = vi.fn();
        textarea.addEventListener('keydown', editorKeydown);
        harness.transformText = vi.fn((fn) => {
            const next = fn({ value: textarea.value, selectionStart: textarea.selectionStart, selectionEnd: textarea.selectionEnd });
            textarea.value = next.value;
            textarea.setSelectionRange(next.selectionStart, next.selectionEnd);
            textarea.dispatchEvent(new Event('input'));
            return true;
        });

        const wrapper = track(mount(TagAutocomplete, { props: { textarea, dbKey: PERSONAL }, attachTo: host }));
        // Load the index first, as the sidebar would have.
        textarea.value = '---\ntags: w';
        textarea.setSelectionRange(11, 11);
        textarea.dispatchEvent(new Event('input'));
        await settle();
        textarea.dispatchEvent(new Event('input'));
        await nextTick();

        const options = wrapper.findAll('[role="option"]');
        expect(options.map((option) => option.text())).toEqual(['wonder', 'Work']);

        const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        textarea.dispatchEvent(enter);
        expect(enter.defaultPrevented).toBe(true);
        expect(editorKeydown).not.toHaveBeenCalled();
        expect(textarea.value).toBe('---\ntags: wonder');
        await nextTick();
        expect(wrapper.find('[role="listbox"]').exists()).toBe(false);

        // Esc dismisses; other keys pass through to the editor.
        textarea.value = '---\ntags:\n  - wo';
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        textarea.dispatchEvent(new Event('input'));
        await nextTick();
        expect(wrapper.find('[role="listbox"]').exists()).toBe(true);
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await nextTick();
        expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
        expect(editorKeydown).toHaveBeenCalled();
    });
});

describe('tag filter helpers', () => {
    const folders = [
        { id: 'b', name: 'Trash', parent_id: null, created_at: '2026-02-01' },
        { id: 'a', name: '  TRASH ', parent_id: null, created_at: '2026-01-01' },
        { id: 'a1', name: 'Old', parent_id: 'a', created_at: '2026-01-02' },
        { id: 'a2', name: 'Older', parent_id: 'a1', created_at: '2026-01-03' },
        { id: 'p', name: 'Projects', parent_id: null, created_at: '2026-01-01' },
        { id: 'n', name: 'Trash', parent_id: 'p', created_at: '2026-01-01' },
    ];

    it('takes the oldest top-level Trash and everything below it, never a nested one', () => {
        expect(trashFolderId(folders)).toBe('a');
        expect(trashFolderIds(folders)).toEqual(new Set(['a', 'a1', 'a2']));
        expect(trashFolderIds([{ id: 'x', name: 'Projects', parent_id: null }])).toEqual(new Set());
    });

    it('builds folder paths and survives a cycle', () => {
        const pathOf = folderPaths([...folders, { id: 'c1', name: 'C1', parent_id: 'c2' }, { id: 'c2', name: 'C2', parent_id: 'c1' }]);
        expect(pathOf('a2')).toBe('  TRASH  / Old / Older');
        expect(pathOf('n')).toBe('Projects / Trash');
        expect(pathOf(null)).toBe('');
        expect(pathOf('c1')).toBe('C2 / C1');
    });
});

// Browser harness for typewriter mode (see app.html). Not part of the app.
import { createApp, h, nextTick } from 'vue';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import '@/assets/main.css';
import '@/assets/phone.css';
import ContentArea from '@/components/ContentArea.vue';
import SubMenuBar from '@/components/SubMenuBar.vue';
import ToastContainer from '@/components/ToastContainer.vue';
import PhoneEditor from '@/components/phone/PhoneEditor.vue';
import { useStructureStore } from '@/store/structureStore';
import { useDocStore } from '@/store/docStore';
import { useUiStore } from '@/store/uiStore';
import { useThemeStore } from '@/store/themeStore';
import { useEditorStore } from '@/store/editorStore';
import { useTypewriterStore } from '@/store/typewriterStore';
import { useAddonsStore } from '@/store/addonsStore';

const params = new URLSearchParams(window.location.search);
const phone = params.get('phone') === '1';

const sentence = (i) => `Sentence ${i} is here to fill the row with words. `;
export const FIXTURE = [
    '# Typewriter fixture',
    '',
    ...Array.from({ length: 30 }, (_, i) => `${sentence(i * 3)}${sentence(i * 3 + 1)}${sentence(i * 3 + 2)}`.trim()).flatMap((p) => [p, '']),
    '## Lists and code',
    '',
    '- item one with a term inside',
    '  continued line',
    '- item two',
    '',
    '```js',
    'const a = 1;',
    'const b = 2;',
    '```',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    '> a quote line',
    '> another quote line',
    '',
    'The last paragraph. It has two sentences.',
].join('\n');

const pinia = createPinia();
const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:rest(.*)*', component: { render: () => null } }],
});

const app = createApp({
    render: () => (phone
        ? h('div', { class: 'phone-ui', style: 'position:fixed;inset:0;display:flex;flex-direction:column' }, [
            h('div', { style: 'flex:1;min-height:0;position:relative' }, [h(PhoneEditor)]),
            h(ToastContainer),
        ])
        : h('div', { style: 'height:100vh;display:flex;flex-direction:column' }, [
            h(SubMenuBar),
            h(ContentArea),
            h(ToastContainer),
        ])),
});
app.use(pinia);
app.use(router);

const structure = useStructureStore(pinia);
const doc = useDocStore(pinia);
const ui = useUiStore(pinia);
const theme = useThemeStore(pinia);
const editorStore = useEditorStore(pinia);
const typewriter = useTypewriterStore(pinia);

// Nothing is saved and nothing is fetched: there is no database or backend here.
doc.updateFileContent = async () => {};
useAddonsStore(pinia).fetchAddons = async () => {};
theme.initializeTheme?.();
if (params.get('theme') === 'dark') theme.setPreference('dark');
ui.showPreview = params.get('preview') === '1';

async function openDocument(content, id = 'doc-1') {
    structure.selectedFileId = id;
    await nextTick();
    structure.selectedFile = {
        id,
        title: 'Typewriter fixture',
        content,
        dbKey: 'user:harness',
        updated_at: new Date().toISOString(),
    };
    await nextTick();
}

await router.push(phone ? '/doc?mode=write' : '/');
app.mount('#app');
await openDocument(params.get('empty') === '1' ? '' : FIXTURE);

window.harness = { FIXTURE, typewriter, ui, doc, structure, theme, editorStore, openDocument, nextTick };
window.harnessReady = true;

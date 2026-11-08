// @vitest-environment jsdom
// The Editor menu's Typewriter toggle and options popover
// (docs/specs/active/typewriter-mode.md §9.4, §9.6).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mount } from '@vue/test-utils';
import { nextTick, reactive } from 'vue';

const defaults = { enabled: false, scrolling: 'typewriter', anchorPercent: 50, contextLines: 3, highlightLine: true, dim: 'paragraph', dimStrength: 'medium' };
const store = reactive({
    current: { ...defaults },
    get enabled() { return store.current.enabled; },
    toggle: vi.fn(() => { store.current = { ...store.current, enabled: !store.current.enabled }; return store.current.enabled; }),
    update: vi.fn((patch) => { store.current = { ...store.current, ...patch }; }),
});
const ui = reactive({ editorMenuCollapsed: false });

vi.mock('@/store/typewriterStore', () => ({ useTypewriterStore: () => store }));
vi.mock('@/store/uiStore', () => ({ useUiStore: () => ui }));

const { default: TypewriterMenuControls } = await import('@/components/TypewriterMenuControls.vue');

function setup() {
    return mount(TypewriterMenuControls, { attachTo: document.body });
}
const inBody = (testid) => document.body.querySelector(`[data-testid="${testid}"]`);

describe('Editor menu: Typewriter', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        store.current = { ...defaults };
        store.toggle.mockClear();
        store.update.mockClear();
    });

    it('sits next to Scroll Sync in the Editor menu', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/components/SubMenuBar.vue'), 'utf8');
        expect(source).toMatch(/data-testid="submenu-editor-scroll-sync"[\s\S]*?<TypewriterMenuControls \/>/);
    });

    it('shows its state with aria-pressed and toggles the mode', async () => {
        const wrapper = setup();
        const button = wrapper.get('[data-testid="submenu-editor-typewriter"]');
        expect(button.attributes('aria-pressed')).toBe('false');
        expect(button.attributes('title')).toMatch(/Shift/);
        await button.trigger('click');
        expect(store.toggle).toHaveBeenCalledTimes(1);
        expect(button.attributes('aria-pressed')).toBe('true');
        wrapper.unmount();
    });

    it('opens the options popover, whose controls update the store', async () => {
        const wrapper = setup();
        const options = wrapper.get('[data-testid="submenu-editor-typewriter-options"]');
        expect(options.attributes('aria-expanded')).toBe('false');
        await options.trigger('click');
        await nextTick();
        expect(options.attributes('aria-expanded')).toBe('true');
        expect(inBody('typewriter-options')).not.toBeNull();

        inBody('typewriter-options-enabled').click();
        expect(store.update).toHaveBeenLastCalledWith({ enabled: true });
        inBody('typewriter-options-scrolling-margin').click();
        expect(store.update).toHaveBeenLastCalledWith({ scrolling: 'margin' });
        inBody('typewriter-options-lines-plus').click();
        expect(store.update).toHaveBeenLastCalledWith({ contextLines: 4 });
        inBody('typewriter-options-highlight').click();
        expect(store.update).toHaveBeenLastCalledWith({ highlightLine: false });
        inBody('typewriter-options-dim-sentence').click();
        expect(store.update).toHaveBeenLastCalledWith({ dim: 'sentence' });
        inBody('typewriter-options-strength-strong').click();
        expect(store.update).toHaveBeenLastCalledWith({ dimStrength: 'strong' });
        wrapper.unmount();
    });

    it('hides the dependent controls (§9.6)', async () => {
        const wrapper = setup();
        await wrapper.get('[data-testid="submenu-editor-typewriter-options"]').trigger('click');
        await nextTick();
        expect(inBody('typewriter-options-line-position')).not.toBeNull();
        inBody('typewriter-options-anchor-67').click();
        expect(store.update).toHaveBeenLastCalledWith({ anchorPercent: 67 });

        store.current = { ...store.current, scrolling: 'margin' };
        await nextTick();
        expect(inBody('typewriter-options-line-position')).toBeNull();
        expect(inBody('typewriter-options-context-lines')).not.toBeNull();

        store.current = { ...store.current, scrolling: 'off', dim: 'off' };
        await nextTick();
        expect(inBody('typewriter-options-context-lines')).toBeNull();
        expect(inBody('typewriter-options-dim-strength')).toBeNull();
        wrapper.unmount();
    });

    it('closes on Escape and on a click outside', async () => {
        const wrapper = setup();
        const options = wrapper.get('[data-testid="submenu-editor-typewriter-options"]');
        await options.trigger('click');
        await nextTick();
        inBody('typewriter-options').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await nextTick();
        expect(inBody('typewriter-options')).toBeNull();

        await options.trigger('click');
        await nextTick();
        expect(inBody('typewriter-options')).not.toBeNull();
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        await nextTick();
        expect(inBody('typewriter-options')).toBeNull();
        wrapper.unmount();
    });
});

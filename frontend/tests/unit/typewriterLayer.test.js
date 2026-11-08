// @vitest-environment jsdom
// TypewriterLayer draws typewriter mode's band and scrim, and the editor wires
// it in (docs/specs/active/typewriter-mode.md §4.3, §11.2, §13.2).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mount } from '@vue/test-utils';
import TypewriterLayer from '@/components/TypewriterLayer.vue';

// jsdom's import.meta.url is not a file URL; Vitest runs from frontend/.
const read = (path) => readFileSync(resolve(process.cwd(), 'src', path), 'utf8');

describe('TypewriterLayer', () => {
    it('is hidden from assistive technology and takes no pointer events', () => {
        const wrapper = mount(TypewriterLayer);
        const root = wrapper.get('[data-testid="typewriter-layer"]');
        expect(root.attributes('aria-hidden')).toBe('true');
        expect(root.classes()).toContain('pn-typewriter-layer');
        expect(wrapper.findAll('[data-testid="typewriter-scrim"]')).toHaveLength(4);
    });

    it('places the band and up to four scrim rectangles from numbers only', () => {
        const wrapper = mount(TypewriterLayer);
        wrapper.vm.render({
            band: { x: 0, y: 120, w: 600, h: 22 },
            scrims: [{ x: 0, y: 0, w: 600, h: 100 }, { x: 0, y: 160, w: 600, h: 900 }],
            scrimColor: 'rgb(255 255 255 / 0.6)',
        });
        const band = wrapper.get('[data-testid="typewriter-band"]').element;
        expect(band.style.display).toBe('block');
        expect(band.style.transform).toBe('translate(0px, 120px)');
        expect(band.style.height).toBe('22px');
        const scrims = wrapper.findAll('[data-testid="typewriter-scrim"]').map((node) => node.element);
        expect(scrims.map((node) => node.style.display)).toEqual(['block', 'block', 'none', 'none']);
        expect(scrims[1].style.transform).toBe('translate(0px, 160px)');
        expect(scrims[0].style.backgroundColor).not.toBe('');

        wrapper.vm.render({ band: null, scrims: [], scrimColor: 'rgb(0 0 0 / 0.4)' });
        expect(band.style.display).toBe('none');
        expect(scrims.every((node) => node.style.display === 'none')).toBe(true);
        wrapper.vm.render(null);
        expect(band.style.display).toBe('none');
    });
});

describe('typewriter wiring (source checks)', () => {
    const editor = read('components/Editor.vue');

    it('handles Ctrl/Cmd+Shift+Enter in handleKeydown, on desktop only, with a toast', () => {
        const handler = editor.slice(editor.indexOf('function handleKeydown'), editor.indexOf('/* ───── Handle Native Input'));
        expect(handler).toMatch(/\(e\.ctrlKey \|\| e\.metaKey\) && e\.shiftKey && e\.key === 'Enter' && !props\.phone/);
        expect(handler).toContain('e.preventDefault()');
        expect(handler).toContain('typewriterStore.toggle()');
        expect(handler).toContain("'Typewriter mode on' : 'Typewriter mode off', 'info', 2000");
    });

    it('takes the overlay off before OverType is destroyed', () => {
        const destroy = editor.slice(editor.indexOf('function destroyEditor'), editor.indexOf('/* ───── watch for file presence'));
        expect(destroy.indexOf('wrapperEl.value = null')).toBeGreaterThan(-1);
        expect(destroy.indexOf('wrapperEl.value = null')).toBeLessThan(destroy.indexOf('editorInstance.value.destroy()'));
    });

    it('tells the controller about every highlight-layer rebuild, and teleports the layer into the wrapper', () => {
        expect(editor).toMatch(/onChange: \(value\) => \{\s*handleInput\(value\);\s*notifyTypewriter\(\);/);
        expect(editor).toContain('wrapperEl.value = editor.wrapper;');
        expect(editor).toMatch(/<Teleport v-if="typewriterLayerHost" :to="typewriterLayerHost">/);
    });

    it('is given the element that scrolls the editor', () => {
        expect(read('components/ContentArea.vue')).toContain("provide('editorScrollContainer', getEditorScrollEl)");
        const phone = read('components/phone/PhoneEditor.vue');
        expect(phone).toContain("provide('editorScrollContainer', writeEl)");
        expect(phone).toContain("provide('editorBottomInset'");
    });
});

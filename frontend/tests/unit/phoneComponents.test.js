// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import SegmentedControl from '@/components/phone/SegmentedControl.vue';
import KeyRow from '@/components/phone/KeyRow.vue';
import BottomSheet from '@/components/phone/BottomSheet.vue';
import NoteCard from '@/components/phone/NoteCard.vue';
import { WRITE_KEYS } from '@/utils/markdownKeys';

const mounted = [];
function track(wrapper) {
    mounted.push(wrapper);
    return wrapper;
}

afterEach(() => {
    while (mounted.length) mounted.pop().unmount();
    document.body.innerHTML = '';
});

describe('SegmentedControl', () => {
    it('marks the chosen option with aria-pressed and emits the new value', async () => {
        const wrapper = track(mount(SegmentedControl, {
            props: {
                modelValue: 'write',
                label: 'Editor mode',
                options: [{ value: 'write', label: 'Write' }, { value: 'preview', label: 'Preview' }],
            },
        }));
        const buttons = wrapper.findAll('button');
        expect(wrapper.attributes('role')).toBe('group');
        expect(buttons.map((button) => button.attributes('aria-pressed'))).toEqual(['true', 'false']);
        await buttons[1].trigger('click');
        expect(wrapper.emitted('update:modelValue')).toEqual([['preview']]);
    });
});

describe('KeyRow', () => {
    it('keeps the text field focused: pointerdown is prevented and click presses the key', async () => {
        const wrapper = track(mount(KeyRow, { props: { keys: WRITE_KEYS }, attachTo: document.body }));
        const heading = wrapper.find('[data-testid="phone-key-heading"]');
        const event = new Event('pointerdown', { bubbles: true, cancelable: true });
        heading.element.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        await heading.trigger('click');
        expect(wrapper.emitted('press')).toEqual([['heading']]);
        expect(heading.attributes('aria-label')).toBe('Heading');
    });

    it('hides the keyboard by blurring the focused field', async () => {
        const input = document.createElement('textarea');
        document.body.appendChild(input);
        input.focus();
        const wrapper = track(mount(KeyRow, { props: { keys: WRITE_KEYS }, attachTo: document.body }));
        await wrapper.find('[data-testid="phone-key-hide-keyboard"]').trigger('click');
        expect(document.activeElement).not.toBe(input);
        expect(wrapper.emitted('hide')).toHaveLength(1);
    });
});

describe('BottomSheet', () => {
    it('is a modal dialog that focuses its autofocus field and returns focus on close', async () => {
        const opener = document.createElement('button');
        document.body.appendChild(opener);
        opener.focus();
        const wrapper = track(mount(BottomSheet, {
            props: { open: false, label: 'New note' },
            slots: { default: '<textarea data-autofocus></textarea>' },
            attachTo: document.body,
            global: { stubs: { transition: false } },
        }));
        await wrapper.setProps({ open: true });
        await nextTick();
        await nextTick();
        const dialog = wrapper.find('[role="dialog"]');
        expect(dialog.attributes('aria-modal')).toBe('true');
        expect(dialog.attributes('aria-label')).toBe('New note');
        expect(document.activeElement?.tagName).toBe('TEXTAREA');

        await dialog.trigger('keydown', { key: 'Escape' });
        expect(wrapper.emitted('close')).toHaveLength(1);

        await wrapper.setProps({ open: false });
        await nextTick();
        expect(document.activeElement).toBe(opener);
    });

    it('asks to close when the scrim is tapped', async () => {
        const wrapper = track(mount(BottomSheet, {
            props: { open: true, label: 'Menu' },
            global: { stubs: { transition: false } },
        }));
        await wrapper.find('.ph-sheet-scrim').trigger('click');
        expect(wrapper.emitted('close')).toHaveLength(1);
    });
});

describe('NoteCard', () => {
    const doc = {
        id: 'n1',
        dbKey: 'user:me',
        name: 'Trip',
        content: '# Trip\n\n**Pack** the [adapter](http://x)\n- [x] Passport\n- [ ] Rail pass\n```\nraw `code`\n```',
        folderId: 'f1',
        folderName: 'Travel / Japan',
        isPinned: true,
        spaceName: null,
    };

    it('shows readable lines with no markdown syntax', () => {
        const wrapper = track(mount(NoteCard, { props: { doc } }));
        const text = wrapper.text();
        expect(text).toContain('Pack the adapter');
        expect(text).toContain('Passport');
        expect(text).not.toMatch(/[#*`]|\]\(|\[x\]/);
        expect(wrapper.find('.ph-line-done').text()).toContain('Passport');
        expect(wrapper.find('.ph-folder-chip').text()).toBe('Japan');
        expect(wrapper.attributes('aria-label')).toBe('Trip, pinned, in Japan');
    });

    it('is a link that opens on tap and selects while selecting', async () => {
        const wrapper = track(mount(NoteCard, { props: { doc } }));
        expect(wrapper.element.tagName).toBe('A');
        expect(wrapper.attributes('href')).toBe('#/doc/n1?dbKey=user%3Ame');
        await wrapper.trigger('click');
        expect(wrapper.emitted('open')).toHaveLength(1);

        await wrapper.setProps({ selecting: true });
        await wrapper.trigger('click');
        expect(wrapper.emitted('select')).toHaveLength(1);
        expect(wrapper.attributes('aria-label')).toContain('not selected');
    });
});

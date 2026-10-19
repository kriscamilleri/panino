import { describe, it, expect } from 'vitest';
import { findTaskLines, toggleTaskAt, isTaskChecked } from '@/utils/markdownTasks';
import {
    cycleHeading,
    toggleBullet,
    toggleTask,
    wrapSelection,
    insertLink,
    indentLines,
    insertAtCaret,
} from '@/utils/markdownKeys';
import { resolveInitialMode } from '@/utils/editorMode';
import { deriveSyncStatus, editorStatusLine } from '@/utils/syncStatus';

const caret = (value, at = value.length) => ({ value, selectionStart: at, selectionEnd: at });

describe('markdownTasks', () => {
    it('finds task lines in source order, across markers and nesting', () => {
        const source = [
            '# Groceries',
            '- [ ] Milk',
            '* [x] Eggs',
            '  + [X] Nested',
            '1. [ ] Numbered',
            '> - [ ] Quoted',
            '- not a task',
            '- [] not a box',
        ].join('\n');
        expect(findTaskLines(source)).toEqual([1, 2, 3, 4, 5]);
    });

    it('skips fenced code and opening front matter', () => {
        const source = [
            '---',
            'title: x',
            '- [ ] in front matter',
            '---',
            '```md',
            '- [ ] in a fence',
            '```',
            '~~~',
            '- [ ] tilde fence',
            '~~~',
            '- [ ] real',
        ].join('\n');
        expect(findTaskLines(source)).toEqual([10]);
    });

    it('toggles exactly the requested task line both ways', () => {
        const source = '- [ ] a\n- [x] b\n- [ ] c';
        const first = toggleTaskAt(source, 1);
        expect(first).toEqual({ text: '- [ ] a\n- [ ] b\n- [ ] c', line: 1, checked: false });
        const second = toggleTaskAt(first.text, 2);
        expect(second.text).toBe('- [ ] a\n- [ ] b\n- [x] c');
        expect(second.checked).toBe(true);
    });

    it('keeps the rest of the line, including text that looks like a box', () => {
        const result = toggleTaskAt('- [ ] buy [ ] tape', 0);
        expect(result.text).toBe('- [x] buy [ ] tape');
    });

    it('refuses when the rendered count disagrees or the index is out of range', () => {
        expect(toggleTaskAt('- [ ] a\n- [ ] b', 0, 3)).toBeNull();
        expect(toggleTaskAt('- [ ] a', 4)).toBeNull();
        expect(toggleTaskAt('', 0)).toBeNull();
    });

    it('reports checked state', () => {
        expect(isTaskChecked('- [x] done')).toBe(true);
        expect(isTaskChecked('- [ ] open')).toBe(false);
        expect(isTaskChecked('plain')).toBe(false);
    });
});

describe('markdownKeys', () => {
    it('cycles a heading through three levels and back', () => {
        let state = caret('Title', 2);
        state = cycleHeading(state);
        expect(state.value).toBe('# Title');
        expect(state.selectionStart).toBe(4);
        state = cycleHeading(state);
        expect(state.value).toBe('## Title');
        state = cycleHeading(cycleHeading(state));
        expect(state.value).toBe('Title');
        expect(state.selectionStart).toBe(2);
    });

    it('only changes the caret line in a multi-line document', () => {
        const state = cycleHeading({ value: 'one\ntwo\nthree', selectionStart: 5, selectionEnd: 5 });
        expect(state.value).toBe('one\n# two\nthree');
        expect(state.selectionStart).toBe(7);
    });

    it('toggles bullets over a multi-line selection and keeps the selection on the text', () => {
        const value = 'a\nb\nc';
        const on = toggleBullet({ value, selectionStart: 0, selectionEnd: value.length });
        expect(on.value).toBe('- a\n- b\n- c');
        expect(on.value.slice(on.selectionStart, on.selectionEnd)).toBe('a\n- b\n- c');
        const off = toggleBullet(on);
        expect(off.value).toBe(value);
    });

    it('does not touch the line after a selection that ends at a line start', () => {
        const state = toggleBullet({ value: 'a\nb', selectionStart: 0, selectionEnd: 2 });
        expect(state.value).toBe('- a\nb');
    });

    it('turns bullets into tasks and tasks back into plain lines', () => {
        const task = toggleTask(caret('- milk'));
        expect(task.value).toBe('- [ ] milk');
        expect(toggleTask(caret('milk')).value).toBe('- [ ] milk');
        expect(toggleTask(caret('  - [x] milk')).value).toBe('  milk');
        expect(toggleBullet(caret('- [ ] milk')).value).toBe('- milk');
    });

    it('wraps a selection and unwraps it again', () => {
        const wrapped = wrapSelection({ value: 'say hi now', selectionStart: 4, selectionEnd: 6 }, '**');
        expect(wrapped.value).toBe('say **hi** now');
        expect(wrapped.value.slice(wrapped.selectionStart, wrapped.selectionEnd)).toBe('hi');
        expect(wrapSelection(wrapped, '**').value).toBe('say hi now');
    });

    it('puts the caret between markers when nothing is selected', () => {
        const state = wrapSelection(caret('x '), '_');
        expect(state.value).toBe('x __');
        expect(state.selectionStart).toBe(3);
        expect(state.selectionEnd).toBe(3);
    });

    it('inserts a link around the selection with the url selected', () => {
        const state = insertLink({ value: 'see docs', selectionStart: 4, selectionEnd: 8 });
        expect(state.value).toBe('see [docs](url)');
        expect(state.value.slice(state.selectionStart, state.selectionEnd)).toBe('url');
        const empty = insertLink(caret(''));
        expect(empty.value).toBe('[text](url)');
        expect(empty.value.slice(empty.selectionStart, empty.selectionEnd)).toBe('text');
    });

    it('indents touched lines and inserts at the caret', () => {
        expect(indentLines(caret('- a')).value).toBe('  - a');
        const inserted = insertAtCaret({ value: 'ab', selectionStart: 1, selectionEnd: 2 }, 'XY');
        expect(inserted).toEqual({ value: 'aXY', selectionStart: 3, selectionEnd: 3 });
    });
});

describe('resolveInitialMode', () => {
    it('honours an explicit route mode first', () => {
        expect(resolveInitialMode({ requested: 'write', preference: 'preview', content: 'x\n\nbody' })).toBe('write');
    });

    it('uses the setting when it is not automatic', () => {
        expect(resolveInitialMode({ preference: 'write', content: 'body' })).toBe('write');
        expect(resolveInitialMode({ preference: 'preview', content: '' })).toBe('preview');
    });

    it('opens existing Documents in Preview and new ones in Write', () => {
        expect(resolveInitialMode({ preference: 'auto', content: '# Title\n\nSome text' })).toBe('preview');
        expect(resolveInitialMode({ preference: 'auto', content: '# Untitled\n\n' })).toBe('write');
        expect(resolveInitialMode({ requested: 'bogus', content: '' })).toBe('write');
    });
});

describe('syncStatus', () => {
    const base = { isOnline: true, syncEnabled: true, isSyncing: false, databases: [] };

    it('derives each state', () => {
        expect(deriveSyncStatus(base).state).toBe('synced');
        expect(deriveSyncStatus({ ...base, isSyncing: true }).state).toBe('syncing');
        expect(deriveSyncStatus({ ...base, isOnline: false }).state).toBe('offline');
        expect(deriveSyncStatus({ ...base, syncEnabled: false }).state).toBe('off');
        const error = deriveSyncStatus({ ...base, databases: [{ status: 'ready' }, { status: 'sync-error', error: 'Boom' }] });
        expect(error.state).toBe('error');
        expect(error.error).toBe('Boom');
    });

    it('lets offline win over an error', () => {
        expect(deriveSyncStatus({ ...base, isOnline: false, databases: [{ status: 'sync-error' }] }).state).toBe('offline');
    });

    it('writes the editor status line', () => {
        const synced = deriveSyncStatus(base);
        expect(editorStatusLine({ sync: synced, folderName: 'Work' })).toBe('Work · saved');
        expect(editorStatusLine({ sync: synced, isDirty: true })).toBe('Saving…');
        expect(editorStatusLine({ sync: synced, liveCount: 2 })).toBe('Live · 2 editing');
        expect(editorStatusLine({ sync: deriveSyncStatus({ ...base, isOnline: false }) })).toBe('Saved on this phone');
        expect(editorStatusLine({ sync: deriveSyncStatus({ ...base, databases: [{ status: 'quota-error' }] }) }))
            .toBe('Not synced — tap to retry');
    });
});
